package web

import (
	"encoding/csv"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/andrewmooreio/squirrel/internal/store"
	"github.com/andrewmooreio/squirrel/internal/web/views"
)

// maxImportBytes caps the size of an uploaded CSV file.
const maxImportBytes = 1 << 20

var csvHeader = []string{"name", "count", "category", "location", "store", "notes"}

func (s *server) transfer(w http.ResponseWriter, r *http.Request) {
	s.render(w, r, http.StatusOK, views.Transfer(s.page("Import and export", "lists")))
}

func (s *server) exportCSV(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListItems(r.Context(), store.ItemFilter{})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/csv; charset=utf-8")
	h.Set("Content-Disposition", `attachment; filename="squirrel-items-`+time.Now().UTC().Format("2006-01-02")+`.csv"`)
	h.Set("Cache-Control", "no-store")

	cw := csv.NewWriter(w)
	_ = cw.Write(csvHeader)
	for _, it := range items {
		_ = cw.Write([]string{it.Name, strconv.Itoa(it.Count), it.CategoryName, it.LocationName, it.StoreName, it.Notes})
	}
	cw.Flush()
}

func (s *server) importCSV(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxImportBytes)
	file, _, err := r.FormFile("file")
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			s.transferMessage(w, r, http.StatusRequestEntityTooLarge, "The file is too big. Use a file of 1 MB or less.")
			return
		}
		s.transferMessage(w, r, http.StatusBadRequest, "Choose a CSV file.")
		return
	}
	defer func() { _ = file.Close() }()

	rows, status, msg := readImportRows(file)
	if msg != "" {
		s.transferMessage(w, r, status, msg)
		return
	}
	res, err := s.store.ImportItems(r.Context(), rows)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.render(w, r, http.StatusOK, views.ImportDone(s.page("Import done", "lists"), views.ImportDoneData{Result: res}))
}

func (s *server) transferMessage(w http.ResponseWriter, r *http.Request, status int, body string) {
	s.render(w, r, status, views.Message(s.page("Import failed", "lists"), "Import failed", body, "/transfer", "Back to import"))
}

const (
	msgUnreadable = "Squirrel cannot read this file. Check that it is a CSV file."
	msgColumns    = "The file needs these columns: name, category, location, store."
)

// readImportRows parses the CSV. On a problem it returns an HTTP status and
// a message for the user.
func readImportRows(src io.Reader) ([]store.ImportRow, int, string) {
	cr := csv.NewReader(src)
	cr.FieldsPerRecord = -1
	cr.TrimLeadingSpace = false

	head, err := cr.Read()
	if err != nil {
		return nil, readStatus(err), readMessage(err)
	}
	col := map[string]int{}
	for i, h := range head {
		if i == 0 {
			h = strings.TrimPrefix(h, "\ufeff")
		}
		name := strings.ToLower(strings.TrimSpace(h))
		if _, dup := col[name]; !dup {
			col[name] = i
		}
	}
	for _, need := range []string{"name", "category", "location", "store"} {
		if _, ok := col[need]; !ok {
			return nil, http.StatusUnprocessableEntity, msgColumns
		}
	}
	field := func(rec []string, name string) string {
		if i, ok := col[name]; ok && i < len(rec) {
			return rec[i]
		}
		return ""
	}

	var rows []store.ImportRow
	for {
		rec, err := cr.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, readStatus(err), readMessage(err)
		}
		line, _ := cr.FieldPos(0)
		row := store.ImportRow{
			Line:     line,
			Name:     field(rec, "name"),
			Count:    field(rec, "count"),
			Category: field(rec, "category"),
			Location: field(rec, "location"),
			Store:    field(rec, "store"),
			Notes:    field(rec, "notes"),
		}
		if blankRow(row) {
			continue
		}
		rows = append(rows, row)
	}
	return rows, 0, ""
}

func blankRow(r store.ImportRow) bool {
	for _, v := range []string{r.Name, r.Count, r.Category, r.Location, r.Store, r.Notes} {
		if strings.TrimSpace(v) != "" {
			return false
		}
	}
	return true
}

// readStatus and readMessage map a read error. A body over the limit is a
// 413. Any other error means the file is not valid CSV.
func readStatus(err error) int {
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		return http.StatusRequestEntityTooLarge
	}
	return http.StatusUnprocessableEntity
}

func readMessage(err error) string {
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		return "The file is too big. Use a file of 1 MB or less."
	}
	if errors.Is(err, io.EOF) {
		return msgColumns
	}
	return msgUnreadable
}
