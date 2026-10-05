package web

import (
	"net/http"
	"sort"
	"strings"

	"github.com/andrewmooreio/squirrel/internal/store"
	"github.com/andrewmooreio/squirrel/internal/web/views"
)

// noStore names the group of items that have no store.
const noStore = "No store"

func (s *server) shopping(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListItems(r.Context(), store.ItemFilter{OutOfStock: true})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.render(w, r, http.StatusOK, views.Shopping(s.page("Shopping list", "shopping"), views.ShoppingData{Groups: groupByStore(items)}))
}

// groupByStore groups items by store. Groups follow store-name order,
// ignoring case. Items with no store come last.
func groupByStore(items []store.Item) []views.ShoppingGroup {
	at := map[int64]int{} // store id to index in groups
	var groups []views.ShoppingGroup
	var none []store.Item
	for _, it := range items {
		if it.StoreName == "" {
			none = append(none, it)
			continue
		}
		i, ok := at[it.StoreID]
		if !ok {
			groups = append(groups, views.ShoppingGroup{Store: it.StoreName})
			i = len(groups) - 1
			at[it.StoreID] = i
		}
		groups[i].Items = append(groups[i].Items, it)
	}
	sort.SliceStable(groups, func(i, j int) bool {
		return strings.ToLower(groups[i].Store) < strings.ToLower(groups[j].Store)
	})
	if len(none) > 0 {
		groups = append(groups, views.ShoppingGroup{Store: noStore, Items: none})
	}
	return groups
}
