package web

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/andrewmooreio/squirrel/internal/store"
	"github.com/andrewmooreio/squirrel/internal/web/views"
)

// formLists loads the three lists for the item form.
func (s *server) formLists(r *http.Request, d *views.ItemFormData) error {
	var err error
	if d.Categories, err = s.store.Lists(r.Context(), store.Categories); err != nil {
		return err
	}
	if d.Locations, err = s.store.Lists(r.Context(), store.Locations); err != nil {
		return err
	}
	d.Stores, err = s.store.Lists(r.Context(), store.Stores)
	return err
}

func (s *server) newItem(w http.ResponseWriter, r *http.Request) {
	d := views.ItemFormData{}
	if err := s.formLists(r, &d); err != nil {
		s.fail(w, r, err)
		return
	}
	// An item needs one value from each list, so send the user to set them up.
	if len(d.Categories) == 0 || len(d.Locations) == 0 || len(d.Stores) == 0 {
		http.Redirect(w, r, "/lists/categories", http.StatusSeeOther)
		return
	}
	s.render(w, r, http.StatusOK, views.ItemForm(s.page("Add item", ""), d))
}

func (s *server) editItem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		s.notFound(w, r)
		return
	}
	it, err := s.store.GetItem(r.Context(), id)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	d := views.ItemFormData{
		ID: it.ID, Name: it.Name, Count: it.Count, Notes: it.Notes,
		CategoryID: it.CategoryID, LocationID: it.LocationID, StoreID: it.StoreID,
	}
	if err := s.formLists(r, &d); err != nil {
		s.fail(w, r, err)
		return
	}
	s.render(w, r, http.StatusOK, views.ItemForm(s.page("Edit "+it.Name, ""), d))
}

// readItemForm turns the posted form into form data and store input.
func readItemForm(r *http.Request, id int64) (views.ItemFormData, store.ItemInput, map[string]string) {
	errs := map[string]string{}
	count := 0
	if id == 0 {
		raw := strings.TrimSpace(r.PostFormValue("count"))
		if raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 0 {
				errs["count"] = "Enter a whole number of 0 or more."
			} else {
				count = n
			}
		}
	}
	in := store.ItemInput{
		Name:       r.PostFormValue("name"),
		Count:      count,
		CategoryID: parseID(r.PostFormValue("category_id")),
		LocationID: parseID(r.PostFormValue("location_id")),
		StoreID:    parseID(r.PostFormValue("store_id")),
		Notes:      r.PostFormValue("notes"),
	}
	d := views.ItemFormData{
		ID: id, Name: in.Name, Count: count, Notes: in.Notes,
		CategoryID: in.CategoryID, LocationID: in.LocationID, StoreID: in.StoreID,
	}
	return d, in, errs
}

// formErrors merges a store error into errs. It returns false if err is not
// a user error.
func formErrors(errs map[string]string, err error) bool {
	var verr *store.ValidationError
	switch {
	case errors.As(err, &verr):
		for k, v := range verr.Fields {
			errs[k] = v
		}
	case errors.Is(err, store.ErrDuplicate):
		errs["name"] = "Another item already has this name."
	default:
		return false
	}
	return true
}

func (s *server) createItem(w http.ResponseWriter, r *http.Request) {
	d, in, errs := readItemForm(r, 0)
	if len(errs) == 0 {
		if _, err := s.store.CreateItem(r.Context(), in); err == nil {
			http.Redirect(w, r, "/", http.StatusSeeOther)
			return
		} else if !formErrors(errs, err) {
			s.fail(w, r, err)
			return
		}
	}
	s.rerenderForm(w, r, d, errs, "Add item")
}

func (s *server) updateItem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		s.notFound(w, r)
		return
	}
	d, in, errs := readItemForm(r, id)
	if len(errs) == 0 {
		if _, err := s.store.UpdateItem(r.Context(), id, in); err == nil {
			http.Redirect(w, r, itemPath(id), http.StatusSeeOther)
			return
		} else if !formErrors(errs, err) {
			s.fail(w, r, err)
			return
		}
	}
	s.rerenderForm(w, r, d, errs, "Edit item")
}

func (s *server) rerenderForm(w http.ResponseWriter, r *http.Request, d views.ItemFormData, errs map[string]string, title string) {
	d.Errors = errs
	if err := s.formLists(r, &d); err != nil {
		s.fail(w, r, err)
		return
	}
	s.render(w, r, http.StatusUnprocessableEntity, views.ItemForm(s.page(title, ""), d))
}

func itemPath(id int64) string { return "/items/" + strconv.FormatInt(id, 10) }

func (s *server) showItem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		s.notFound(w, r)
		return
	}
	s.renderItemPage(w, r, id, http.StatusOK, "")
}

func (s *server) renderItemPage(w http.ResponseWriter, r *http.Request, id int64, status int, msg string) {
	it, err := s.store.GetItem(r.Context(), id)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	hist, err := s.store.History(r.Context(), id, historyLen)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.render(w, r, status, views.ItemPage(s.page(it.Name, ""), views.ItemPageData{Item: it, History: hist, Error: msg}))
}

func (s *server) deleteItem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		s.notFound(w, r)
		return
	}
	if err := s.store.DeleteItem(r.Context(), id); err != nil {
		s.fail(w, r, err)
		return
	}
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// countDone answers a successful count change. On the item page the history
// also changed, so HTMX reloads the page; elsewhere it swaps the row.
func (s *server) countDone(w http.ResponseWriter, r *http.Request, it store.Item, msg string) {
	if !isHTMX(r) {
		backTo(w, r, itemPath(it.ID))
		return
	}
	if cur, err := url.Parse(r.Header.Get("HX-Current-URL")); err == nil && strings.HasPrefix(cur.Path, "/items/") && msg == "" {
		w.Header().Set("HX-Refresh", "true")
	}
	s.render(w, r, http.StatusOK, views.Row(it, msg))
}

func (s *server) adjustItem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		s.notFound(w, r)
		return
	}
	delta, err := strconv.Atoi(r.PostFormValue("delta"))
	if err != nil || (delta != 1 && delta != -1) {
		s.message(w, r, http.StatusBadRequest, "Bad request", "The change must be +1 or −1.")
		return
	}
	it, err := s.store.Adjust(r.Context(), id, delta)
	if errors.Is(err, store.ErrBelowZero) {
		s.countFailed(w, r, id, "The count cannot go below 0.")
		return
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.countDone(w, r, it, "")
}

func (s *server) setCount(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		s.notFound(w, r)
		return
	}
	n, err := strconv.Atoi(strings.TrimSpace(r.PostFormValue("count")))
	if err != nil || n < 0 {
		s.countFailed(w, r, id, "Enter a whole number of 0 or more.")
		return
	}
	it, err := s.store.SetCount(r.Context(), id, n)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.countDone(w, r, it, "")
}

// countFailed shows msg next to the item. HTMX gets the row back with the
// unchanged count; a plain form post gets an error page.
func (s *server) countFailed(w http.ResponseWriter, r *http.Request, id int64, msg string) {
	if !isHTMX(r) {
		s.message(w, r, http.StatusBadRequest, "Count not changed", msg)
		return
	}
	it, err := s.store.GetItem(r.Context(), id)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.countDone(w, r, it, msg)
}

func (s *server) undoItem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		s.notFound(w, r)
		return
	}
	_, err := s.store.Undo(r.Context(), id)
	switch {
	case err == nil:
		http.Redirect(w, r, itemPath(id), http.StatusSeeOther)
	case errors.Is(err, store.ErrBelowZero):
		s.renderItemPage(w, r, id, http.StatusConflict, "Undo would make the count negative, so Squirrel left it as it is.")
	default:
		s.fail(w, r, err)
	}
}
