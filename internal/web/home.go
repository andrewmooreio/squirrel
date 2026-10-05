package web

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/andrewmooreio/squirrel/internal/store"
	"github.com/andrewmooreio/squirrel/internal/web/views"
)

// tabNone is the tab value for items with no category.
const tabNone = "none"

// view is the state of the main page, taken from the query string.
type view struct {
	tab        string
	q          string
	locationID int64
	storeID    int64
	sort       string
}

func parseView(r *http.Request) view {
	q := r.URL.Query()
	return view{
		tab:        q.Get("tab"),
		q:          strings.TrimSpace(q.Get("q")),
		locationID: parseID(q.Get("loc")),
		storeID:    parseID(q.Get("store")),
		sort:       q.Get("sort"),
	}
}

// href returns the URL of the main page for tab, keeping the search and
// filters.
func (v view) href(tab string) string {
	vals := url.Values{}
	if tab != "" {
		vals.Set("tab", tab)
	}
	if v.q != "" {
		vals.Set("q", v.q)
	}
	if v.locationID != 0 {
		vals.Set("loc", strconv.FormatInt(v.locationID, 10))
	}
	if v.storeID != 0 {
		vals.Set("store", strconv.FormatInt(v.storeID, 10))
	}
	if v.sort != "" {
		vals.Set("sort", v.sort)
	}
	if len(vals) == 0 {
		return "/"
	}
	return "/?" + vals.Encode()
}

func (v view) filtered() bool { return v.q != "" || v.locationID != 0 || v.storeID != 0 }

func (s *server) home(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	v := parseView(r)

	cats, err := s.store.Lists(ctx, store.Categories)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	locs, err := s.store.Lists(ctx, store.Locations)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	stores, err := s.store.Lists(ctx, store.Stores)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	hasUncat, err := s.store.HasUncategorised(ctx)
	if err != nil {
		s.fail(w, r, err)
		return
	}

	// While a search is active the view acts as the All tab.
	active := v.tab
	if v.q != "" {
		active = ""
	}
	f := store.ItemFilter{Search: v.q, LocationID: v.locationID, StoreID: v.storeID, Sort: v.sort}
	switch {
	case active == tabNone:
		f.Uncategorised = true
	case active != "":
		f.CategoryID = parseID(active)
		if f.CategoryID == 0 {
			active = ""
		}
	}
	items, err := s.store.ListItems(ctx, f)
	if err != nil {
		s.fail(w, r, err)
		return
	}

	tabs := []views.Tab{{Label: "All", Href: v.href(""), Active: active == ""}}
	for _, c := range cats {
		id := strconv.FormatInt(c.ID, 10)
		tabs = append(tabs, views.Tab{Label: c.Name, Href: v.href(id), Active: active == id})
	}
	if hasUncat {
		tabs = append(tabs, views.Tab{Label: "Uncategorised", Href: v.href(tabNone), Active: active == tabNone})
	}

	stock := views.StockData{
		Tabs:      tabs,
		Items:     items,
		AnyItems:  len(items) > 0,
		CanAdd:    len(cats) > 0 && len(locs) > 0 && len(stores) > 0,
		Filtered:  v.filtered(),
		ClearHref: (view{sort: v.sort}).href(active),
	}
	if len(cats) == 0 {
		stock.Missing = append(stock.Missing, "category")
	}
	if len(locs) == 0 {
		stock.Missing = append(stock.Missing, "location")
	}
	if len(stores) == 0 {
		stock.Missing = append(stock.Missing, "store")
	}
	if len(items) == 0 {
		all, err := s.store.ListItems(ctx, store.ItemFilter{})
		if err != nil {
			s.fail(w, r, err)
			return
		}
		stock.AnyItems = len(all) > 0
	}

	data := views.HomeData{
		Tab:        v.tab,
		Query:      v.q,
		LocationID: v.locationID,
		StoreID:    v.storeID,
		Sort:       v.sort,
		Locations:  locs,
		Stores:     stores,
		Stock:      stock,
	}

	w.Header().Set("Vary", "HX-Request, HX-Target")
	switch {
	case isHTMX(r) && hxTargetID(r) == "stock":
		s.render(w, r, http.StatusOK, views.Stock(stock))
	case isHTMX(r):
		s.render(w, r, http.StatusOK, views.Main(data))
	default:
		s.render(w, r, http.StatusOK, views.Home(s.page("Stock", ""), data))
	}
}
