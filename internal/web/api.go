package web

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/andrewmooreio/squirrel/internal/store"
)

// apiItem is an item as the JSON API shows it. A blank list field is null.
type apiItem struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	Count     int       `json:"count"`
	Category  *string   `json:"category"`
	Location  *string   `json:"location"`
	Store     *string   `json:"store"`
	Notes     string    `json:"notes"`
	UpdatedAt time.Time `json:"updated_at"`
}

func newAPIItem(it store.Item) apiItem {
	return apiItem{
		ID:        it.ID,
		Name:      it.Name,
		Count:     it.Count,
		Category:  nullable(it.CategoryName),
		Location:  nullable(it.LocationName),
		Store:     nullable(it.StoreName),
		Notes:     it.Notes,
		UpdatedAt: it.UpdatedAt.UTC(),
	}
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("write json: %v", err)
	}
}

func apiError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// apiID reads an optional id query parameter. Blank means no filter.
func apiID(r *http.Request, name string) (int64, bool) {
	v := strings.TrimSpace(r.URL.Query().Get(name))
	if v == "" {
		return 0, true
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n < 0 {
		return 0, false
	}
	return n, true
}

func (s *server) apiItems(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := store.ItemFilter{Search: q.Get("q"), Sort: q.Get("sort")}
	var ok bool
	if cat := strings.TrimSpace(q.Get("category")); cat == "none" {
		f.Uncategorised = true
	} else if f.CategoryID, ok = apiID(r, "category"); !ok {
		apiError(w, http.StatusBadRequest, "Invalid category.")
		return
	}
	if f.LocationID, ok = apiID(r, "location"); !ok {
		apiError(w, http.StatusBadRequest, "Invalid location.")
		return
	}
	if f.StoreID, ok = apiID(r, "store"); !ok {
		apiError(w, http.StatusBadRequest, "Invalid store.")
		return
	}
	items, err := s.store.ListItems(r.Context(), f)
	if err != nil {
		s.apiFail(w, r, err)
		return
	}
	out := make([]apiItem, 0, len(items))
	for _, it := range items {
		out = append(out, newAPIItem(it))
	}
	writeJSON(w, http.StatusOK, map[string][]apiItem{"items": out})
}

func (s *server) apiItem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		s.apiNotFound(w, r)
		return
	}
	it, err := s.store.GetItem(r.Context(), id)
	if err != nil {
		s.apiFail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newAPIItem(it))
}

// apiReadOnly answers a known API path sent with a method other than GET.
func (s *server) apiReadOnly(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Allow", "GET, HEAD")
	apiError(w, http.StatusMethodNotAllowed, "Method not allowed.")
}

// apiNotFound is the catch-all for /api/, so API clients never get HTML.
func (s *server) apiNotFound(w http.ResponseWriter, _ *http.Request) {
	apiError(w, http.StatusNotFound, "Not found.")
}

func (s *server) apiFail(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, store.ErrNotFound) {
		apiError(w, http.StatusNotFound, "Not found.")
		return
	}
	log.Printf("%s %s: %v", r.Method, r.URL.Path, err)
	apiError(w, http.StatusInternalServerError, "Something went wrong.")
}
