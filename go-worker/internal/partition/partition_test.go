package partition

import "testing"

func TestNodeCompatiblePartitionIDs(t *testing.T) {
	tests := []struct {
		symbol      string
		count, want int
	}{
		{"BTC-INR", 3, 0}, {"ETH-INR", 3, 1}, {"SOL-INR", 3, 0},
		{"A😀B", 7, 6},
	}
	for _, test := range tests {
		got, err := ID(test.symbol, test.count)
		if err != nil {
			t.Fatal(err)
		}
		if got != test.want {
			t.Errorf("ID(%q, %d) = %d, want %d", test.symbol, test.count, got, test.want)
		}
	}
}

func TestValidate(t *testing.T) {
	if err := Validate(2, 3); err != nil {
		t.Fatal(err)
	}
	if err := Validate(3, 3); err == nil {
		t.Fatal("expected invalid partition")
	}
}
