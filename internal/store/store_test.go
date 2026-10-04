package store_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"sync"
	"testing"

	"github.com/andrewmooreio/squirrel/internal/store"
)

func newStore(t *testing.T) *store.Store {
	t.Helper()
	s, _ := newStoreAt(t)
	return s
}

func newStoreAt(t *testing.T) (*store.Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	s, err := store.Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := s.Migrate(context.Background()); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s, path
}

// rawDB opens a second connection to the database file, to set up states
// that the store interface cannot reach on its own.
func rawDB(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// fixture creates one value in each managed list and returns an item input
// that uses them.
func fixture(t *testing.T, s *store.Store, name string) store.ItemInput {
	t.Helper()
	ctx := context.Background()
	mk := func(kind store.ListKind, n string) int64 {
		id, err := s.CreateListValue(ctx, kind, n)
		if err != nil {
			t.Fatalf("CreateListValue(%s, %s): %v", kind, n, err)
		}
		return id
	}
	return store.ItemInput{
		Name:       name,
		CategoryID: mk(store.Categories, "Cat "+name),
		LocationID: mk(store.Locations, "Loc "+name),
		StoreID:    mk(store.Stores, "Shop "+name),
	}
}

func createItem(t *testing.T, s *store.Store, name string, count int) store.Item {
	t.Helper()
	in := fixture(t, s, name)
	in.Count = count
	item, err := s.CreateItem(context.Background(), in)
	if err != nil {
		t.Fatalf("CreateItem: %v", err)
	}
	return item
}

func TestConcurrentAdjust(t *testing.T) {
	t.Parallel()
	s := newStore(t)
	item := createItem(t, s, "Toothpaste", 0)

	const n = 50
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for range n {
		wg.Go(func() {
			if _, err := s.Adjust(context.Background(), item.ID, 1); err != nil {
				errs <- err
			}
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("Adjust: %v", err)
	}

	got, err := s.GetItem(context.Background(), item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Count != n {
		t.Errorf("count = %d, want %d", got.Count, n)
	}
	hist, err := s.History(context.Background(), item.ID, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(hist) != n {
		t.Errorf("history has %d entries, want %d", len(hist), n)
	}
}

func TestAdjustNeverBelowZero(t *testing.T) {
	t.Parallel()
	s := newStore(t)
	item := createItem(t, s, "Tomatoes", 0)

	_, err := s.Adjust(context.Background(), item.ID, -1)
	if !errors.Is(err, store.ErrBelowZero) {
		t.Fatalf("err = %v, want ErrBelowZero", err)
	}
	got, _ := s.GetItem(context.Background(), item.ID)
	if got.Count != 0 {
		t.Errorf("count = %d, want 0", got.Count)
	}
	hist, _ := s.History(context.Background(), item.ID, 10)
	if len(hist) != 0 {
		t.Errorf("history has %d entries, want 0", len(hist))
	}
}

func TestSetCount(t *testing.T) {
	t.Parallel()
	s := newStore(t)
	ctx := context.Background()
	item := createItem(t, s, "Nuts", 3)

	if _, err := s.SetCount(ctx, item.ID, 10); err != nil {
		t.Fatal(err)
	}
	hist, _ := s.History(ctx, item.ID, 10)
	if len(hist) == 0 || hist[0].Delta != 7 || hist[0].Count != 10 {
		t.Fatalf("latest change = %+v, want delta 7 count 10", hist)
	}
	before := len(hist)

	if _, err := s.SetCount(ctx, item.ID, 10); err != nil {
		t.Fatal(err)
	}
	hist, _ = s.History(ctx, item.ID, 10)
	if len(hist) != before {
		t.Errorf("setting the same count recorded a change")
	}

	var verr *store.ValidationError
	if _, err := s.SetCount(ctx, item.ID, -1); !errors.As(err, &verr) {
		t.Errorf("negative count: err = %v, want ValidationError", err)
	}
}

func TestUndo(t *testing.T) {
	t.Parallel()
	s := newStore(t)
	ctx := context.Background()
	item := createItem(t, s, "Soap", 0)

	_, _ = s.Adjust(ctx, item.ID, 1)
	_, _ = s.SetCount(ctx, item.ID, 5)

	got, err := s.Undo(ctx, item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Count != 1 {
		t.Errorf("after undo count = %d, want 1", got.Count)
	}
	hist, _ := s.History(ctx, item.ID, 10)
	if len(hist) != 1 || hist[0].Delta != 1 {
		t.Errorf("history after undo = %+v, want only the +1", hist)
	}
}

func TestUndoNothing(t *testing.T) {
	t.Parallel()
	s := newStore(t)
	item := createItem(t, s, "Foil", 0)
	if _, err := s.Undo(context.Background(), item.ID); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}

func TestUndoBelowZero(t *testing.T) {
	t.Parallel()
	s, path := newStoreAt(t)
	ctx := context.Background()
	item := createItem(t, s, "Rice", 0)

	if _, err := s.SetCount(ctx, item.ID, 5); err != nil { // change +5
		t.Fatal(err)
	}
	// Simulate a concurrent change that left the count lower than the
	// latest change can reverse.
	if _, err := rawDB(t, path).Exec(`UPDATE items SET count = 3 WHERE id = ?`, item.ID); err != nil {
		t.Fatal(err)
	}

	_, err := s.Undo(ctx, item.ID)
	if !errors.Is(err, store.ErrBelowZero) {
		t.Fatalf("err = %v, want ErrBelowZero", err)
	}
	got, _ := s.GetItem(ctx, item.ID)
	if got.Count != 3 {
		t.Errorf("count = %d, want 3 (unchanged)", got.Count)
	}
	hist, _ := s.History(ctx, item.ID, 10)
	if len(hist) != 1 {
		t.Errorf("history has %d entries, want 1 (unchanged)", len(hist))
	}
}

func TestDeleteListValueLeavesItemsBlank(t *testing.T) {
	t.Parallel()
	s := newStore(t)
	ctx := context.Background()
	item := createItem(t, s, "Bleach", 2)

	for _, tc := range []struct {
		kind store.ListKind
		id   int64
	}{
		{store.Categories, item.CategoryID},
		{store.Locations, item.LocationID},
		{store.Stores, item.StoreID},
	} {
		if err := s.DeleteListValue(ctx, tc.kind, tc.id); err != nil {
			t.Fatalf("DeleteListValue(%s): %v", tc.kind, err)
		}
	}

	got, err := s.GetItem(ctx, item.ID)
	if err != nil {
		t.Fatalf("item was deleted with its list values: %v", err)
	}
	if got.CategoryID != 0 || got.LocationID != 0 || got.StoreID != 0 {
		t.Errorf("references not cleared: %+v", got)
	}
	if got.Count != 2 {
		t.Errorf("count = %d, want 2", got.Count)
	}
}

func TestDeleteItemDeletesHistory(t *testing.T) {
	t.Parallel()
	s, path := newStoreAt(t)
	ctx := context.Background()
	item := createItem(t, s, "Pasta", 0)
	_, _ = s.Adjust(ctx, item.ID, 1)

	if err := s.DeleteItem(ctx, item.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetItem(ctx, item.ID); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("GetItem err = %v, want ErrNotFound", err)
	}
	var n int
	if err := rawDB(t, path).QueryRow(`SELECT count(*) FROM changes WHERE item_id = ?`, item.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("%d orphaned changes remain", n)
	}
}

func TestNameUniqueness(t *testing.T) {
	t.Parallel()
	s := newStore(t)
	ctx := context.Background()

	if _, err := s.CreateListValue(ctx, store.Categories, "Toiletries"); err != nil {
		t.Fatal(err)
	}
	for _, dup := range []string{"toiletries", "  TOILETRIES  "} {
		if _, err := s.CreateListValue(ctx, store.Categories, dup); !errors.Is(err, store.ErrDuplicate) {
			t.Errorf("CreateListValue(%q) err = %v, want ErrDuplicate", dup, err)
		}
	}
	// The same name in a different list is fine.
	if _, err := s.CreateListValue(ctx, store.Locations, "Toiletries"); err != nil {
		t.Errorf("same name in another list: %v", err)
	}

	in := fixture(t, s, "Beans")
	if _, err := s.CreateItem(ctx, in); err != nil {
		t.Fatal(err)
	}
	in.Name = " beans "
	if _, err := s.CreateItem(ctx, in); !errors.Is(err, store.ErrDuplicate) {
		t.Errorf("duplicate item err = %v, want ErrDuplicate", err)
	}
}
