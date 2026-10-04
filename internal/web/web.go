// Package web holds Squirrel's HTTP handlers, routing and embedded assets.
package web

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/a-h/templ"

	"github.com/andrewmooreio/squirrel/internal/store"
	"github.com/andrewmooreio/squirrel/internal/web/views"
)

//go:embed static
var staticFS embed.FS

const historyLen = 10

type server struct {
	store *store.Store
	// ver busts the browser cache of the embedded assets after an upgrade.
	ver    string
	static http.Handler
}

// New returns the full Squirrel application as an http.Handler.
func New(st *store.Store) http.Handler {
	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		panic(err) // the embedded directory always exists
	}
	s := &server{
		store:  st,
		ver:    strconv.FormatInt(time.Now().Unix(), 36),
		static: http.StripPrefix("/static/", http.FileServerFS(sub)),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.home)
	mux.HandleFunc("GET /healthz", s.healthz)
	mux.HandleFunc("GET /manifest.webmanifest", s.manifest)
	mux.HandleFunc("GET /static/", s.serveStatic)

	mux.HandleFunc("GET /items/new", s.newItem)
	mux.HandleFunc("POST /items", s.createItem)
	mux.HandleFunc("GET /items/{id}", s.showItem)
	mux.HandleFunc("GET /items/{id}/edit", s.editItem)
	mux.HandleFunc("POST /items/{id}", s.updateItem)
	mux.HandleFunc("POST /items/{id}/delete", s.deleteItem)
	mux.HandleFunc("POST /items/{id}/adjust", s.adjustItem)
	mux.HandleFunc("POST /items/{id}/count", s.setCount)
	mux.HandleFunc("POST /items/{id}/undo", s.undoItem)

	mux.HandleFunc("GET /lists", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/lists/categories", http.StatusSeeOther)
	})
	mux.HandleFunc("GET /lists/{kind}", s.showLists)
	mux.HandleFunc("POST /lists/{kind}", s.createListValue)
	mux.HandleFunc("POST /lists/{kind}/{id}", s.renameListValue)
	mux.HandleFunc("POST /lists/{kind}/{id}/delete", s.deleteListValue)

	mux.HandleFunc("/", s.notFound)
	return s.recoverer(mux)
}

func (s *server) page(title, nav string) views.Page {
	return views.Page{Title: title + " · Squirrel", Nav: nav, Ver: s.ver}
}

func (s *server) render(w http.ResponseWriter, r *http.Request, status int, c templ.Component) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if err := c.Render(r.Context(), w); err != nil {
		log.Printf("render %s: %v", r.URL.Path, err)
	}
}

func (s *server) message(w http.ResponseWriter, r *http.Request, status int, heading, body string) {
	s.render(w, r, status, views.Message(s.page(heading, ""), heading, body, "/", "Back to the list"))
}

func (s *server) notFound(w http.ResponseWriter, r *http.Request) {
	s.message(w, r, http.StatusNotFound, "Not found", "This page does not exist.")
}

func (s *server) fail(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, store.ErrNotFound) {
		s.notFound(w, r)
		return
	}
	log.Printf("%s %s: %v", r.Method, r.URL.Path, err)
	s.message(w, r, http.StatusInternalServerError, "Something went wrong", "Try again. If it keeps happening, check the server log.")
}

func (s *server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				log.Printf("panic %s %s: %v", r.Method, r.URL.Path, v)
				s.message(w, r, http.StatusInternalServerError, "Something went wrong", "Try again.")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *server) healthz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if err := s.store.Ping(ctx); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte("database unreachable\n"))
		return
	}
	_, _ = w.Write([]byte("ok\n"))
}

const manifestJSON = `{
  "name": "Squirrel",
  "short_name": "Squirrel",
  "description": "Count the stock in your house.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#f97316",
  "icons": [
    {"src": "/static/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
    {"src": "/static/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
    {"src": "/static/icon.svg", "sizes": "any", "type": "image/svg+xml"}
  ]
}
`

func (s *server) manifest(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/manifest+json")
	_, _ = w.Write([]byte(manifestJSON))
}

func (s *server) serveStatic(w http.ResponseWriter, r *http.Request) {
	// Requests with ?v= come from our own pages, so they can be cached hard.
	if r.URL.Query().Get("v") != "" {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	s.static.ServeHTTP(w, r)
}

// isHTMX reports whether the request came from HTMX and not from a full
// page load or a history restore.
func isHTMX(r *http.Request) bool {
	return r.Header.Get("HX-Request") == "true" && r.Header.Get("HX-History-Restore-Request") != "true"
}

// hxTargetID returns the id of the element HTMX swaps into. HTMX 4 sends it
// as tag#id, for example div#stock.
func hxTargetID(r *http.Request) string {
	_, id, _ := strings.Cut(r.Header.Get("HX-Target"), "#")
	return id
}

// backTo redirects to the page the form was sent from, or to fallback.
func backTo(w http.ResponseWriter, r *http.Request, fallback string) {
	dest := fallback
	if ref, err := url.Parse(r.Referer()); err == nil && ref.Path != "" && strings.HasPrefix(ref.Path, "/") &&
		!strings.HasPrefix(ref.Path, "//") && (ref.Host == "" || ref.Host == r.Host) {
		dest = ref.RequestURI()
	}
	http.Redirect(w, r, dest, http.StatusSeeOther)
}

func pathID(r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	return id, err == nil && id > 0
}

func parseID(s string) int64 {
	id, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	if err != nil || id < 0 {
		return 0
	}
	return id
}
