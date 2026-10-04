package web

import (
	"errors"
	"net/http"

	"github.com/andrewmooreio/squirrel/internal/store"
	"github.com/andrewmooreio/squirrel/internal/web/views"
)

func (s *server) kind(w http.ResponseWriter, r *http.Request) (store.ListKind, bool) {
	k := store.ListKind(r.PathValue("kind"))
	if !k.Valid() {
		s.notFound(w, r)
		return "", false
	}
	return k, true
}

func (s *server) showLists(w http.ResponseWriter, r *http.Request) {
	k, ok := s.kind(w, r)
	if !ok {
		return
	}
	s.renderLists(w, r, views.ListsData{Kind: k}, http.StatusOK)
}

func (s *server) renderLists(w http.ResponseWriter, r *http.Request, d views.ListsData, status int) {
	vals, err := s.store.Lists(r.Context(), d.Kind)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	d.Values = vals
	s.render(w, r, status, views.Lists(s.page("Manage lists", "lists"), d))
}

// listError turns a store error into text for the user. It returns "" for
// errors that are not the user's doing.
func listError(err error) string {
	var verr *store.ValidationError
	switch {
	case errors.As(err, &verr):
		return verr.Fields["name"]
	case errors.Is(err, store.ErrDuplicate):
		return "This name is already in the list."
	}
	return ""
}

func (s *server) createListValue(w http.ResponseWriter, r *http.Request) {
	k, ok := s.kind(w, r)
	if !ok {
		return
	}
	name := r.PostFormValue("name")
	_, err := s.store.CreateListValue(r.Context(), k, name)
	if err == nil {
		http.Redirect(w, r, listURLPath(k), http.StatusSeeOther)
		return
	}
	msg := listError(err)
	if msg == "" {
		s.fail(w, r, err)
		return
	}
	s.renderLists(w, r, views.ListsData{Kind: k, Error: msg, NewName: name}, http.StatusUnprocessableEntity)
}

func (s *server) renameListValue(w http.ResponseWriter, r *http.Request) {
	k, ok := s.kind(w, r)
	if !ok {
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		s.notFound(w, r)
		return
	}
	err := s.store.RenameListValue(r.Context(), k, id, r.PostFormValue("name"))
	if err == nil {
		http.Redirect(w, r, listURLPath(k), http.StatusSeeOther)
		return
	}
	msg := listError(err)
	if msg == "" {
		s.fail(w, r, err)
		return
	}
	s.renderLists(w, r, views.ListsData{Kind: k, ErrorID: id, ErrorText: msg}, http.StatusUnprocessableEntity)
}

func (s *server) deleteListValue(w http.ResponseWriter, r *http.Request) {
	k, ok := s.kind(w, r)
	if !ok {
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		s.notFound(w, r)
		return
	}
	if err := s.store.DeleteListValue(r.Context(), k, id); err != nil {
		s.fail(w, r, err)
		return
	}
	http.Redirect(w, r, listURLPath(k), http.StatusSeeOther)
}

func listURLPath(k store.ListKind) string { return "/lists/" + string(k) }
