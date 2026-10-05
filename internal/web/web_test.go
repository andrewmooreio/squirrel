package web_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/andrewmooreio/squirrel/internal/store"
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
