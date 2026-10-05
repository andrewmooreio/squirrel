package web_test

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/andrewmooreio/squirrel/internal/store"
	"github.com/andrewmooreio/squirrel/internal/version"
	"github.com/andrewmooreio/squirrel/internal/web"
)

type app struct {
	t     *testing.T
	store *store.Store
	h     http.Handler
}

func newApp(t *testing.T) *app {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	return &app{t: t, store: st, h: web.New(st)}
}

// seed creates one value in each list and returns their ids.
func (a *app) seed() (cat, loc, shop int64) {
	a.t.Helper()
	ctx := context.Background()
	var err error
	if cat, err = a.store.CreateListValue(ctx, store.Categories, "Food"); err != nil {
		a.t.Fatal(err)
	}
	if loc, err = a.store.CreateListValue(ctx, store.Locations, "Garage"); err != nil {
		a.t.Fatal(err)
	}
	if shop, err = a.store.CreateListValue(ctx, store.Stores, "Costco"); err != nil {
		a.t.Fatal(err)
	}
	return
}

func (a *app) item(name string, count int, cat, loc, shop int64) store.Item {
	a.t.Helper()
	it, err := a.store.CreateItem(context.Background(), store.ItemInput{
		Name: name, Count: count, CategoryID: cat, LocationID: loc, StoreID: shop,
	})
	if err != nil {
		a.t.Fatal(err)
	}
	return it
}

type resp struct {
	*httptest.ResponseRecorder
	body string
}

func (a *app) do(method, target string, form url.Values, hdr ...string) resp {
	a.t.Helper()
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req := httptest.NewRequest(method, target, body)
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	rec := httptest.NewRecorder()
	a.h.ServeHTTP(rec, req)
	return resp{rec, rec.Body.String()}
}

func (a *app) get(target string, hdr ...string) resp { return a.do("GET", target, nil, hdr...) }

func (a *app) post(target string, form url.Values, hdr ...string) resp {
	return a.do("POST", target, form, hdr...)
}

// upload posts a multipart form with one file part.
func (a *app) upload(target, field, filename, body string, hdr ...string) resp {
	a.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile(field, filename)
	if err != nil {
		a.t.Fatal(err)
	}
	if _, err := io.WriteString(fw, body); err != nil {
		a.t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		a.t.Fatal(err)
	}
	req := httptest.NewRequest("POST", target, &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	rec := httptest.NewRecorder()
	a.h.ServeHTTP(rec, req)
	return resp{rec, rec.Body.String()}
}

var htmx = []string{"HX-Request", "true"}

func (r resp) wantStatus(t *testing.T, want int) {
	t.Helper()
	if r.Code != want {
		t.Fatalf("status = %d, want %d; body:\n%s", r.Code, want, r.body)
	}
}

func (r resp) wantRedirect(t *testing.T, to string) {
	t.Helper()
	r.wantStatus(t, http.StatusSeeOther)
	if got := r.Header().Get("Location"); got != to {
		t.Fatalf("redirect = %q, want %q", got, to)
	}
}

func (r resp) contains(t *testing.T, subs ...string) {
	t.Helper()
	for _, s := range subs {
		if !strings.Contains(r.body, s) {
			t.Errorf("body does not contain %q; body:\n%s", s, r.body)
		}
	}
}

func (r resp) lacks(t *testing.T, subs ...string) {
	t.Helper()
	for _, s := range subs {
		if strings.Contains(r.body, s) {
			t.Errorf("body contains %q but should not", s)
		}
	}
}

func id(n int64) string { return strconv.FormatInt(n, 10) }

func TestHealthz(t *testing.T) {
	a := newApp(t)
	r := a.get("/healthz")
	r.wantStatus(t, 200)
	r.contains(t, "ok")

	_ = a.store.Close()
	a.get("/healthz").wantStatus(t, http.StatusServiceUnavailable)
}

func TestVersionShown(t *testing.T) {
	old := version.Version
	t.Cleanup(func() { version.Version = old })

	version.Version = "9.9.9"
	a := newApp(t)
	for _, path := range []string{"/", "/lists/categories", "/nope"} {
		a.get(path).contains(t, "Squirrel v9.9.9")
	}

	// Builds that are not a release keep their name as it is.
	for _, v := range []string{"dev", "edge-abc1234"} {
		version.Version = v
		r := a.get("/")
		r.contains(t, "Squirrel "+v)
		r.lacks(t, "Squirrel v"+v)
	}
}

func TestManifestAndAssets(t *testing.T) {
	a := newApp(t)
	r := a.get("/manifest.webmanifest")
	r.wantStatus(t, 200)
	r.contains(t, `"name": "Squirrel"`, "icon-512.png")
	if ct := r.Header().Get("Content-Type"); !strings.Contains(ct, "manifest") {
		t.Errorf("content type = %q", ct)
	}
	for _, p := range []string{
		"/static/app.css", "/static/app.js", "/static/vendor/htmx.min.js",
		"/static/icon.svg", "/static/icons/icon-192.png", "/static/icons/icon-512.png",
		"/static/icons/apple-touch-icon.png",
	} {
		a.get(p).wantStatus(t, 200)
	}
}

func TestFirstStartGuidesToLists(t *testing.T) {
	a := newApp(t)
	r := a.get("/")
	r.wantStatus(t, 200)
	r.contains(t, "Welcome to Squirrel", "category", "location", "store", "Set up lists")
	r.lacks(t, ">Add item<")

	a.get("/items/new").wantRedirect(t, "/lists/categories")

	// Once all three lists have a value the empty state offers to add an item.
	a.seed()
	r = a.get("/")
	r.contains(t, "No items yet", ">Add item<")
	a.get("/items/new").wantStatus(t, 200)
}

func TestHomeTabs(t *testing.T) {
	a := newApp(t)
	food, loc, shop := a.seed()
	tools, _ := a.store.CreateListValue(context.Background(), store.Categories, "Tools")
	a.item("Tomatoes", 4, food, loc, shop)
	a.item("Hammer", 1, tools, loc, shop)

	all := a.get("/")
	all.contains(t, "Tomatoes", "Hammer", ">All<", ">Food<", ">Tools<")
	all.lacks(t, "Uncategorised")

	a.get("/?tab="+id(food)).contains(t, "Tomatoes")
	a.get("/?tab="+id(food)).lacks(t, "Hammer")

	// Deleting a category moves its items to the Uncategorised tab.
	if err := a.store.DeleteListValue(context.Background(), store.Categories, tools); err != nil {
		t.Fatal(err)
	}
	r := a.get("/")
	r.contains(t, "Uncategorised", "Hammer")
	none := a.get("/?tab=none")
	none.contains(t, "Hammer")
	none.lacks(t, "Tomatoes")
}

func TestSearchAndFilters(t *testing.T) {
	a := newApp(t)
	ctx := context.Background()
	food, garage, costco := a.seed()
	pantry, _ := a.store.CreateListValue(ctx, store.Locations, "Pantry")
	aldi, _ := a.store.CreateListValue(ctx, store.Stores, "Aldi")
	a.item("Tomatoes", 4, food, garage, costco)
	a.item("Tomato paste", 2, food, pantry, aldi)
	a.item("Rice", 3, food, pantry, costco)

	// Search spans categories and ignores the tab.
	r := a.get("/?tab=999&q=tomato")
	r.contains(t, "Tomatoes", "Tomato paste")
	r.lacks(t, "Rice")

	a.get("/?loc="+id(pantry)).lacks(t, "Tomatoes")
	a.get("/?store="+id(costco)).lacks(t, "Tomato paste")

	r = a.get("/?q=tomato&loc=" + id(pantry) + "&store=" + id(aldi))
	r.contains(t, "Tomato paste")
	r.lacks(t, "Tomatoes", "Rice")

	r = a.get("/?q=nothing")
	r.contains(t, "No items found", "Clear filters")

	// A search over a non-All tab still searches everything.
	tools, _ := a.store.CreateListValue(ctx, store.Categories, "Tools")
	a.get("/?tab="+id(tools)+"&q=rice").contains(t, "Rice")
}

func TestSort(t *testing.T) {
	a := newApp(t)
	ctx := context.Background()
	food, garage, costco := a.seed()
	apples := a.item("Apples", 5, food, garage, costco)
	a.item("Beans", 1, food, garage, costco)
	cocoa := a.item("Cocoa", 3, food, garage, costco)
	// Timestamps have millisecond resolution, so pause between changes.
	// Cocoa changes last, then Apples, so Cocoa is the most recent.
	for _, id := range []int64{apples.ID, cocoa.ID} {
		time.Sleep(5 * time.Millisecond)
		if _, err := a.store.Adjust(ctx, id, 1); err != nil {
			t.Fatal(err)
		}
	}

	order := func(target string, want ...string) {
		t.Helper()
		r := a.get(target)
		r.wantStatus(t, http.StatusOK)
		last := -1
		for _, name := range want {
			i := strings.Index(r.body, ">"+name+"</a>")
			if i < 0 {
				t.Fatalf("%s: %q not found", target, name)
			}
			if i < last {
				t.Errorf("%s: %q is out of order, want %v", target, name, want)
			}
			last = i
		}
	}
	order("/", "Apples", "Beans", "Cocoa")
	order("/?sort=name-desc", "Cocoa", "Beans", "Apples")
	order("/?sort=count", "Beans", "Cocoa", "Apples")
	order("/?sort=updated", "Cocoa", "Apples", "Beans")
	order("/?sort=bogus", "Apples", "Beans", "Cocoa")

	// Tab links keep the sort.
	a.get("/?sort=count").contains(t, `href="/?sort=count&amp;tab=`+id(food)+`"`)

	// The select marks the current option.
	a.get("/?sort=count").contains(t, `<option value="count" selected>`)
	a.get("/").contains(t, `<option value="" selected>Sort: A to Z</option>`)
	a.get("/?sort=name-desc").contains(t, `<option value="name-desc" selected>Sort: Z to A</option>`)
	a.get("/").contains(t, `>Sort: A to Z</option>`, `>Sort: Z to A</option>`,
		`>Sort: Lowest count first</option>`, `>Sort: Recently changed</option>`)

	// A sort alone is not a filter. Clear filters keeps the sort.
	a.get("/?sort=count").lacks(t, "Clear filters")
	r := a.get("/?sort=count&q=nothing")
	r.contains(t, "No items found", "Clear filters", `href="/?sort=count"`)
}

func TestHTMXFragments(t *testing.T) {
	a := newApp(t)
	food, loc, shop := a.seed()
	a.item("Tomatoes", 4, food, loc, shop)

	// Search updates only the stock region.
	r := a.get("/?q=tom", append(htmx, "HX-Target", "div#stock")...)
	r.wantStatus(t, 200)
	r.contains(t, `id="stock"`, "Tomatoes")
	r.lacks(t, "<html", `id="filters"`)

	// A tab click swaps the search form and the stock region.
	r = a.get("/?tab="+id(food), append(htmx, "HX-Target", "div#main")...)
	r.contains(t, `id="filters"`, `id="stock"`)
	r.lacks(t, "<html")

	a.get("/").contains(t, "<html")
}

func TestAdjust(t *testing.T) {
	a := newApp(t)
	food, loc, shop := a.seed()
	it := a.item("Tomatoes", 1, food, loc, shop)
	path := "/items/" + id(it.ID) + "/adjust"

	r := a.post(path, url.Values{"delta": {"1"}}, htmx...)
	r.wantStatus(t, 200)
	r.contains(t, `id="item-`+id(it.ID)+`"`, `value="2"`)
	r.lacks(t, "<html")

	a.post(path, url.Values{"delta": {"-1"}}, htmx...).contains(t, `value="1"`)
	r = a.post(path, url.Values{"delta": {"-1"}}, htmx...)
	r.contains(t, `value="0"`)
	// At zero the minus button is disabled.
	if !regexp.MustCompile(`(?s)value="-1".{0,300}disabled`).MatchString(r.body) {
		t.Errorf("minus button not disabled at 0:\n%s", r.body)
	}

	// A forced −1 at zero changes nothing and tells the user.
	r = a.post(path, url.Values{"delta": {"-1"}}, htmx...)
	r.wantStatus(t, 200)
	r.contains(t, `value="0"`, "cannot go below 0")

	a.post(path, url.Values{"delta": {"5"}}, htmx...).wantStatus(t, http.StatusBadRequest)
	a.post(path, url.Values{"delta": {"abc"}}, htmx...).wantStatus(t, http.StatusBadRequest)
	a.post("/items/9999/adjust", url.Values{"delta": {"1"}}, htmx...).wantStatus(t, http.StatusNotFound)

	// Without HTMX the action redirects back.
	a.post(path, url.Values{"delta": {"1"}}, "Referer", "http://example.com/?tab=3").wantRedirect(t, "/?tab=3")
	a.post(path, url.Values{"delta": {"1"}}).wantRedirect(t, "/items/"+id(it.ID))

	got, _ := a.store.GetItem(context.Background(), it.ID)
	if got.Count != 2 {
		t.Errorf("count = %d, want 2", got.Count)
	}
}

func TestSetCount(t *testing.T) {
	a := newApp(t)
	food, loc, shop := a.seed()
	it := a.item("Tomatoes", 1, food, loc, shop)
	path := "/items/" + id(it.ID) + "/count"

	a.post(path, url.Values{"count": {"24"}}, htmx...).contains(t, `value="24"`)

	for _, bad := range []string{"-3", "1.5", "abc", ""} {
		r := a.post(path, url.Values{"count": {bad}}, htmx...)
		r.wantStatus(t, 200)
		r.contains(t, "whole number", `value="24"`)
	}
	a.post(path, url.Values{"count": {"-3"}}).wantStatus(t, http.StatusBadRequest)

	hist, _ := a.store.History(context.Background(), it.ID, 10)
	if len(hist) == 0 || hist[0].Delta != 23 {
		t.Errorf("history = %+v, want latest change of +23", hist)
	}
}

func TestItemCreate(t *testing.T) {
	a := newApp(t)
	food, loc, shop := a.seed()

	form := url.Values{
		"name": {"Tomatoes"}, "count": {"6"}, "notes": {"Tins"},
		"category_id": {id(food)}, "location_id": {id(loc)}, "store_id": {id(shop)},
	}
	a.post("/items", form).wantRedirect(t, "/")
	a.get("/").contains(t, "Tomatoes", `value="6"`)

	// Duplicate names, including a different case, are rejected.
	form.Set("name", " tomatoes ")
	r := a.post("/items", form)
	r.wantStatus(t, http.StatusUnprocessableEntity)
	r.contains(t, "already has this name", `value=" tomatoes "`)

	// Name, category, location and store are required; notes are not.
	r = a.post("/items", url.Values{"count": {"2"}})
	r.wantStatus(t, http.StatusUnprocessableEntity)
	r.contains(t, "Enter a name", "Choose a category", "Choose a location", "Choose a store")

	r = a.post("/items", url.Values{"name": {"X"}, "count": {"-1"},
		"category_id": {id(food)}, "location_id": {id(loc)}, "store_id": {id(shop)}})
	r.wantStatus(t, http.StatusUnprocessableEntity)
	r.contains(t, "whole number")

	// The count defaults to 0.
	a.post("/items", url.Values{"name": {"Rice"},
		"category_id": {id(food)}, "location_id": {id(loc)}, "store_id": {id(shop)}}).wantRedirect(t, "/")
	a.get("/?q=rice").contains(t, `value="0"`)
}

func TestItemEdit(t *testing.T) {
	a := newApp(t)
	ctx := context.Background()
	food, loc, shop := a.seed()
	it := a.item("Tomatoes", 3, food, loc, shop)
	a.store.DeleteListValue(ctx, store.Locations, loc) //nolint:errcheck
	newLoc, _ := a.store.CreateListValue(ctx, store.Locations, "Pantry")
	path := "/items/" + id(it.ID)

	// A blank field must be filled in before the edit saves.
	a.get(path+"/edit").wantStatus(t, 200)
	r := a.post(path, url.Values{"name": {"Tomatoes"},
		"category_id": {id(food)}, "store_id": {id(shop)}})
	r.wantStatus(t, http.StatusUnprocessableEntity)
	r.contains(t, "Choose a location")

	a.post(path, url.Values{"name": {"Plum tomatoes"}, "notes": {"Tins"},
		"category_id": {id(food)}, "location_id": {id(newLoc)}, "store_id": {id(shop)}}).
		wantRedirect(t, path)
	a.get(path).contains(t, "Plum tomatoes", "Pantry", "Tins")

	// Editing fields does not change the count or record history.
	got, _ := a.store.GetItem(ctx, it.ID)
	hist, _ := a.store.History(ctx, it.ID, 10)
	if got.Count != 3 || len(hist) != 1 {
		t.Errorf("count = %d, history = %d; want 3 and 1 (the starting count only)", got.Count, len(hist))
	}
	a.get("/items/9999/edit").wantStatus(t, http.StatusNotFound)
}

func TestItemPageHistoryAndUndo(t *testing.T) {
	a := newApp(t)
	food, loc, shop := a.seed()
	it := a.item("Tomatoes", 0, food, loc, shop)
	path := "/items/" + id(it.ID)

	a.get(path).contains(t, "No changes yet")
	a.post(path+"/adjust", url.Values{"delta": {"1"}})
	a.post(path+"/adjust", url.Values{"delta": {"1"}})

	r := a.get(path)
	r.contains(t, "History", "+1", "Undo")
	if n := strings.Count(r.body, ">Undo<"); n != 1 {
		t.Errorf("undo buttons = %d, want 1 (latest change only)", n)
	}

	a.post(path+"/undo", nil).wantRedirect(t, path)
	got, _ := a.store.GetItem(context.Background(), it.ID)
	if got.Count != 1 {
		t.Errorf("count after undo = %d, want 1", got.Count)
	}
}

func TestItemDelete(t *testing.T) {
	a := newApp(t)
	food, loc, shop := a.seed()
	it := a.item("Tomatoes", 2, food, loc, shop)
	path := "/items/" + id(it.ID)

	// The item page carries the confirmation dialog.
	a.get(path).contains(t, "<dialog", "Delete Tomatoes?", "its history")

	a.post(path+"/delete", nil).wantRedirect(t, "/")
	a.get(path).wantStatus(t, http.StatusNotFound)
	a.get("/").lacks(t, "Tomatoes")
	a.post(path+"/delete", nil).wantStatus(t, http.StatusNotFound)
}

func TestLists(t *testing.T) {
	a := newApp(t)
	ctx := context.Background()

	a.get("/lists").wantRedirect(t, "/lists/categories")
	r := a.get("/lists/categories")
	r.wantStatus(t, 200)
	r.contains(t, "Categories", "Locations", "Stores", "No Categories yet")
	a.get("/lists/colours").wantStatus(t, http.StatusNotFound)

	a.post("/lists/categories", url.Values{"name": {"Food"}}).wantRedirect(t, "/lists/categories")
	a.get("/lists/categories").contains(t, "Food", "0 items")

	// Duplicates (any case) and blank names are refused.
	r = a.post("/lists/categories", url.Values{"name": {" FOOD "}})
	r.wantStatus(t, http.StatusUnprocessableEntity)
	r.contains(t, "already in the list")
	a.post("/lists/categories", url.Values{"name": {"  "}}).wantStatus(t, http.StatusUnprocessableEntity)

	// Each list is separate.
	a.post("/lists/locations", url.Values{"name": {"Food"}}).wantRedirect(t, "/lists/locations")

	cats, _ := a.store.Lists(ctx, store.Categories)
	catID := cats[0].ID
	a.post("/lists/categories/"+id(catID), url.Values{"name": {"Pantry"}}).wantRedirect(t, "/lists/categories")
	a.get("/lists/categories").contains(t, "Pantry")

	loc, _ := a.store.CreateListValue(ctx, store.Locations, "Garage")
	shop, _ := a.store.CreateListValue(ctx, store.Stores, "Costco")
	a.item("Tomatoes", 1, catID, loc, shop)
	a.item("Beans", 1, catID, loc, shop)

	// The delete dialog shows how many items use the value.
	r = a.get("/lists/categories")
	r.contains(t, "2 items", "2 items use this category")

	// Deleting a value that is in use is allowed; items stay, blank.
	a.post("/lists/categories/"+id(catID)+"/delete", nil).wantRedirect(t, "/lists/categories")
	a.get("/?tab=none").contains(t, "Tomatoes", "Beans")
	a.post("/lists/categories/"+id(catID)+"/delete", nil).wantStatus(t, http.StatusNotFound)
}

func TestDeletedListValueShowsDash(t *testing.T) {
	a := newApp(t)
	food, loc, shop := a.seed()
	it := a.item("Tomatoes", 1, food, loc, shop)
	if err := a.store.DeleteListValue(context.Background(), store.Locations, loc); err != nil {
		t.Fatal(err)
	}
	a.get("/").contains(t, "—")
	a.get("/items/"+id(it.ID)).contains(t, "—")
}

func TestCrossOriginPostsAreRefused(t *testing.T) {
	a := newApp(t)
	food, loc, shop := a.seed()
	it := a.item("Tomatoes", 2, food, loc, shop)
	path := "/items/" + id(it.ID)

	r := a.post(path+"/delete", nil, "Sec-Fetch-Site", "cross-site")
	r.wantStatus(t, http.StatusForbidden)
	r.contains(t, "another website")
	a.post(path+"/delete", nil, "Origin", "http://evil.example").wantStatus(t, http.StatusForbidden)
	a.get(path).wantStatus(t, 200)

	// Reads from other sites still work, and so do our own posts.
	a.get(path, "Sec-Fetch-Site", "cross-site").wantStatus(t, 200)
	a.post(path+"/delete", nil, "Sec-Fetch-Site", "same-origin").wantRedirect(t, "/")
}

func TestUnknownRoute(t *testing.T) {
	a := newApp(t)
	a.get("/nope").wantStatus(t, http.StatusNotFound)
	a.get("/items/abc").wantStatus(t, http.StatusNotFound)
}

type apiItemJSON struct {
	ID        int64   `json:"id"`
	Name      string  `json:"name"`
	Count     int     `json:"count"`
	Category  *string `json:"category"`
	Location  *string `json:"location"`
	Store     *string `json:"store"`
	Notes     string  `json:"notes"`
	UpdatedAt string  `json:"updated_at"`
}

func (r resp) wantJSON(t *testing.T, status int) {
	t.Helper()
	r.wantStatus(t, status)
	if ct := r.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	if cc := r.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
}

func (r resp) apiNames(t *testing.T) []string {
	t.Helper()
	r.wantJSON(t, http.StatusOK)
	var out struct {
		Items []apiItemJSON `json:"items"`
	}
	if err := json.Unmarshal([]byte(r.body), &out); err != nil {
		t.Fatalf("bad JSON: %v; body:\n%s", err, r.body)
	}
	names := []string{}
	for _, it := range out.Items {
		names = append(names, it.Name)
	}
	return names
}

func (r resp) wantAPIError(t *testing.T, status int, msg string) {
	t.Helper()
	r.wantJSON(t, status)
	var e struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal([]byte(r.body), &e); err != nil || e.Error != msg {
		t.Fatalf("error body = %q, want error %q", r.body, msg)
	}
	r.lacks(t, "<html")
}

func TestAPIItems(t *testing.T) {
	a := newApp(t)
	ctx := context.Background()

	a.get("/api/items").contains(t, `"items":[]`)

	food, garage, costco := a.seed()
	tools, err := a.store.CreateListValue(ctx, store.Categories, "Tools")
	if err != nil {
		t.Fatal(err)
	}
	shed, err := a.store.CreateListValue(ctx, store.Locations, "Shed")
	if err != nil {
		t.Fatal(err)
	}
	aldi, err := a.store.CreateListValue(ctx, store.Stores, "Aldi")
	if err != nil {
		t.Fatal(err)
	}
	a.item("Cocoa", 5, food, garage, costco)
	a.item("Apples", 9, food, shed, aldi)
	a.item("Beans", 1, tools, garage, costco)
	a.item("Dust", 2, tools, shed, aldi)

	r := a.get("/api/items")
	r.wantJSON(t, http.StatusOK)
	var out struct {
		Items []apiItemJSON `json:"items"`
	}
	if err := json.Unmarshal([]byte(r.body), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Items) != 4 || out.Items[0].Name != "Apples" {
		t.Fatalf("items = %+v", out.Items)
	}
	apples := out.Items[0]
	if apples.Count != 9 || apples.Category == nil || *apples.Category != "Food" ||
		apples.Location == nil || *apples.Location != "Shed" || apples.Store == nil || *apples.Store != "Aldi" {
		t.Errorf("apples = %+v", apples)
	}
	if _, err := time.Parse(time.RFC3339, apples.UpdatedAt); err != nil || !strings.HasSuffix(apples.UpdatedAt, "Z") {
		t.Errorf("updated_at = %q, want RFC 3339 UTC", apples.UpdatedAt)
	}

	check := func(target string, want ...string) {
		t.Helper()
		got := a.get(target).apiNames(t)
		if strings.Join(got, ",") != strings.Join(want, ",") {
			t.Errorf("%s = %v, want %v", target, got, want)
		}
	}
	check("/api/items?q=coc", "Cocoa")
	check("/api/items?category="+id(food), "Apples", "Cocoa")
	check("/api/items?category=none")
	check("/api/items?location="+id(garage), "Beans", "Cocoa")
	check("/api/items?store="+id(costco), "Beans", "Cocoa")
	check("/api/items?category="+id(tools)+"&location="+id(shed), "Dust")
	check("/api/items?sort=count", "Beans", "Dust", "Cocoa", "Apples")
	check("/api/items?sort=name-desc", "Dust", "Cocoa", "Beans", "Apples")
	check("/api/items?sort=bogus", "Apples", "Beans", "Cocoa", "Dust")

	for _, bad := range []string{"category=abc", "category=-1", "location=x", "store=1.5"} {
		a.get("/api/items?"+bad).wantJSON(t, http.StatusBadRequest)
	}
	a.get("/api/items?category=abc").wantAPIError(t, http.StatusBadRequest, "Invalid category.")

	// A deleted list value leaves the field null.
	if err := a.store.DeleteListValue(ctx, store.Categories, tools); err != nil {
		t.Fatal(err)
	}
	a.get("/api/items?q=beans").contains(t, `"category":null`)
	check("/api/items?category=none", "Beans", "Dust")
}

func TestAPIItem(t *testing.T) {
	a := newApp(t)
	food, garage, costco := a.seed()
	it := a.item("Cocoa", 5, food, garage, costco)

	r := a.get("/api/items/" + id(it.ID))
	r.wantJSON(t, http.StatusOK)
	var got apiItemJSON
	if err := json.Unmarshal([]byte(r.body), &got); err != nil {
		t.Fatal(err)
	}
	if got.ID != it.ID || got.Name != "Cocoa" || got.Count != 5 ||
		got.Category == nil || *got.Category != "Food" ||
		got.Location == nil || *got.Location != "Garage" ||
		got.Store == nil || *got.Store != "Costco" {
		t.Errorf("item = %+v", got)
	}

	a.get("/api/items/9999").wantAPIError(t, http.StatusNotFound, "Not found.")
	a.get("/api/items/abc").wantAPIError(t, http.StatusNotFound, "Not found.")
	a.get("/api/nothing").wantAPIError(t, http.StatusNotFound, "Not found.")

	for _, target := range []string{"/api/items", "/api/items/" + id(it.ID)} {
		r := a.post(target, nil)
		r.wantAPIError(t, http.StatusMethodNotAllowed, "Method not allowed.")
		if al := r.Header().Get("Allow"); al != "GET, HEAD" {
			t.Errorf("Allow = %q", al)
		}
	}
}

func TestShoppingList(t *testing.T) {
	a := newApp(t)
	ctx := context.Background()
	cat, loc, costco := a.seed()

	// No item at 0.
	a.get("/shopping").contains(t, "Nothing to buy", "Back to the list")

	aldi, err := a.store.CreateListValue(ctx, store.Stores, "Aldi")
	if err != nil {
		t.Fatal(err)
	}
	rice := a.item("Rice", 0, cat, loc, costco)
	a.item("Beans", 2, cat, loc, costco)
	a.item("Milk", 0, cat, loc, aldi)

	r := a.get("/shopping")
	r.wantStatus(t, 200)
	r.contains(t, "Shopping list", "Rice", "Milk")
	if strings.Contains(r.body, "Beans") || strings.Contains(r.body, "Nothing to buy") {
		t.Errorf("page lists an item above 0 or the empty state; body:\n%s", r.body)
	}
	at := func(body, s string) int {
		t.Helper()
		i := strings.Index(body, s)
		if i < 0 {
			t.Fatalf("body does not contain %q; body:\n%s", s, body)
		}
		return i
	}
	hAldi, hCostco := at(r.body, ">Aldi</h2>"), at(r.body, ">Costco</h2>")
	if hAldi > hCostco {
		t.Errorf("Aldi heading is after Costco heading")
	}
	if m := at(r.body, "Take one Milk"); m < hAldi || m > hCostco {
		t.Errorf("Milk is not under Aldi")
	}
	if rc := at(r.body, "Take one Rice"); rc < hCostco {
		t.Errorf("Rice is not under Costco")
	}

	// Items of a deleted store move to a last group.
	if err := a.store.DeleteListValue(ctx, store.Stores, aldi); err != nil {
		t.Fatal(err)
	}
	r = a.get("/shopping")
	if strings.Contains(r.body, ">Aldi</h2>") {
		t.Error("deleted store still has a heading")
	}
	hNone := at(r.body, ">No store</h2>")
	if hNone < at(r.body, ">Costco</h2>") || at(r.body, "Take one Milk") < hNone {
		t.Errorf("Milk is not in the last No store group")
	}

	// A plain post goes back to the shopping list.
	a.post("/items/"+id(rice.ID)+"/adjust", url.Values{"delta": {"1"}}, "Referer", "http://example.com/shopping").
		wantRedirect(t, "/shopping")

	// The header links to the page and marks it when current.
	a.get("/").contains(t, `href="/shopping"`)
	r = a.get("/shopping")
	if !regexp.MustCompile(`href="/shopping"[^>]*data-variant="secondary"`).MatchString(r.body) {
		t.Errorf("Shopping list link is not current; body:\n%s", r.body)
	}
}

func TestExportCSV(t *testing.T) {
	a := newApp(t)
	cat, loc, shop := a.seed()
	a.item("Rice", 3, cat, loc, shop)
	nasty := "Line one, with a comma\nand \"quotes\""
	it := a.item("Beans", 0, cat, loc, shop)
	if _, err := a.store.UpdateItem(context.Background(), it.ID, store.ItemInput{
		Name: "Beans", CategoryID: cat, LocationID: loc, StoreID: shop, Notes: nasty,
	}); err != nil {
		t.Fatal(err)
	}

	r := a.get("/export.csv")
	r.wantStatus(t, 200)
	if got := r.Header().Get("Content-Type"); got != "text/csv; charset=utf-8" {
		t.Errorf("content type = %q", got)
	}
	if got := r.Header().Get("Content-Disposition"); !strings.HasPrefix(got, `attachment; filename="squirrel-items-`) {
		t.Errorf("content disposition = %q", got)
	}
	if got := r.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("cache control = %q", got)
	}

	recs, err := csv.NewReader(strings.NewReader(r.body)).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	want := [][]string{
		{"name", "count", "category", "location", "store", "notes"},
		{"Beans", "0", "Food", "Garage", "Costco", nasty},
		{"Rice", "3", "Food", "Garage", "Costco", ""},
	}
	if len(recs) != len(want) {
		t.Fatalf("rows = %v, want %v", recs, want)
	}
	for i := range want {
		if strings.Join(recs[i], "|") != strings.Join(want[i], "|") {
			t.Errorf("row %d = %q, want %q", i, recs[i], want[i])
		}
	}
}

func TestTransferPage(t *testing.T) {
	a := newApp(t)
	a.get("/transfer").contains(t, "Import and export", `href="/export.csv"`, `action="/import"`, `enctype="multipart/form-data"`, `name="file"`)
	a.get("/lists/categories").contains(t, `href="/transfer"`)
}

func TestImportCSV(t *testing.T) {
	a := newApp(t)
	ctx := context.Background()
	cat, loc, shop := a.seed()
	a.item("Rice", 1, cat, loc, shop)

	file := "name,count,category,location,store,notes\n" +
		"Beans,4,food,Garage,Aldi,Tinned\n" + // line 2: new item, reuses Food, new store
		"rice,2,Food,Garage,Costco,\n" + // line 3: exists
		"Flour,,Food,Garage,Aldi,\n" + // line 4: blank count is 0
		"BEANS,1,Food,Garage,Aldi,\n" + // line 5: duplicate in file
		"Salt,1,,Garage,Aldi,\n" + // line 6: no category
		"Pepper,abc,Food,Garage,Aldi,\n" + // line 7: bad count
		",,,,,\n" + // blank row, ignored
		"Oil,2,Food,Shed,Aldi,\n" // line 9: new location
	r := a.upload("/import", "file", "items.csv", file)
	r.wantStatus(t, 200)
	r.contains(t, "Import done", "Added 3 items.", "Skipped 4 rows.",
		"Line 3, rice: An item with this name exists. Squirrel did not change it.",
		"Line 5, BEANS: An item with this name exists. Squirrel did not change it.",
		"Line 6, Salt: Enter a category.",
		"Line 7, Pepper: Enter a whole number of 0 or more.",
		"Back to the list", "Import another file")

	home := a.get("/")
	home.contains(t, "Beans", "Flour", "Oil")
	home.lacks(t, "Salt", "Pepper")
	a.get("/lists/stores").contains(t, "Aldi")
	a.get("/lists/locations").contains(t, "Shed")
	cats := a.get("/lists/categories")
	if n := strings.Count(cats.body, "Food"); n == 0 || strings.Contains(cats.body, ">food<") || strings.Contains(cats.body, `value="food"`) {
		t.Errorf("categories list has a duplicate or missing Food; body:\n%s", cats.body)
	}
	if vals, _ := a.store.Lists(ctx, store.Categories); len(vals) != 1 {
		t.Errorf("categories = %+v, want 1", vals)
	}

	items, _ := a.store.ListItems(ctx, store.ItemFilter{Search: "Beans"})
	if len(items) != 1 || items[0].Count != 4 || items[0].Notes != "Tinned" {
		t.Fatalf("beans = %+v", items)
	}
	a.get("/items/"+id(items[0].ID)).contains(t, "History", "+4")
	flour, _ := a.store.ListItems(ctx, store.ItemFilter{Search: "Flour"})
	if hist, _ := a.store.History(ctx, flour[0].ID, 10); len(hist) != 0 {
		t.Errorf("flour history = %+v, want none", hist)
	}
	if rice, _ := a.store.ListItems(ctx, store.ItemFilter{Search: "rice"}); len(rice) != 1 || rice[0].Count != 1 {
		t.Errorf("rice changed: %+v", rice)
	}
}

func TestImportCSVSingular(t *testing.T) {
	a := newApp(t)
	r := a.upload("/import", "file", "items.csv", "name,category,location,store\nRice,A,B,C\n")
	r.wantStatus(t, 200)
	r.contains(t, "Added 1 item.")
	r.lacks(t, "Skipped")
}

func TestImportCSVQuotedNewlineLine(t *testing.T) {
	a := newApp(t)
	file := "name,count,category,location,store,notes\n" +
		"Rice,1,A,B,C,\"two\nlines\"\n" +
		",1,A,B,C,\n"
	r := a.upload("/import", "file", "items.csv", file)
	r.wantStatus(t, 200)
	r.contains(t, "Line 4: Enter a name.")
}

func TestImportCSVMissingColumn(t *testing.T) {
	a := newApp(t)
	r := a.upload("/import", "file", "items.csv", "name,category,location\nRice,A,B\n")
	r.wantStatus(t, http.StatusUnprocessableEntity)
	r.contains(t, "The file needs these columns: name, category, location, store.")
	a.get("/").lacks(t, "Rice")
	if items, _ := a.store.ListItems(context.Background(), store.ItemFilter{}); len(items) != 0 {
		t.Errorf("items = %+v, want none", items)
	}
}

func TestImportCSVBOMAndHeaderOrder(t *testing.T) {
	a := newApp(t)
	file := "\ufeff Store ,NAME,Location,Category,Extra,Count\nAldi,Rice,Garage,Food,x,5\n"
	r := a.upload("/import", "file", "items.csv", file)
	r.wantStatus(t, 200)
	r.contains(t, "Added 1 item.")
	items, _ := a.store.ListItems(context.Background(), store.ItemFilter{})
	if len(items) != 1 || items[0].Count != 5 || items[0].StoreName != "Aldi" || items[0].CategoryName != "Food" {
		t.Errorf("items = %+v", items)
	}
}

func TestImportCSVBadRequests(t *testing.T) {
	a := newApp(t)
	r := a.upload("/import", "other", "items.csv", "name\n")
	r.wantStatus(t, http.StatusBadRequest)
	r.contains(t, "Choose a CSV file.")
	a.post("/import", url.Values{"x": {"y"}}).wantStatus(t, http.StatusBadRequest)
	r = a.upload("/import", "file", "items.csv", "name,category,location,store\nRice,\"A,B,C\n")
	r.wantStatus(t, http.StatusUnprocessableEntity)
	r.contains(t, "Squirrel cannot read this file. Check that it is a CSV file.")
	r = a.upload("/import", "file", "items.csv", strings.Repeat("x", 2<<20))
	r.wantStatus(t, http.StatusRequestEntityTooLarge)
	r.contains(t, "The file is too big. Use a file of 1 MB or less.")
}

func TestExportImportRoundTrip(t *testing.T) {
	a := newApp(t)
	cat, loc, shop := a.seed()
	a.item("Rice", 3, cat, loc, shop)
	it := a.item("Beans", 0, cat, loc, shop)
	if _, err := a.store.UpdateItem(context.Background(), it.ID, store.ItemInput{
		Name: "Beans", CategoryID: cat, LocationID: loc, StoreID: shop, Notes: "a, \"b\"\nc",
	}); err != nil {
		t.Fatal(err)
	}
	first := a.get("/export.csv").body

	b := newApp(t)
	r := b.upload("/import", "file", "items.csv", first)
	r.wantStatus(t, 200)
	r.contains(t, "Added 2 items.")
	if second := b.get("/export.csv").body; second != first {
		t.Errorf("exports differ:\n%s\nvs\n%s", first, second)
	}
}
