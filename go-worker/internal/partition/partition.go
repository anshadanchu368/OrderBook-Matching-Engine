package partition

import (
	"fmt"
	"strings"
	"unicode/utf16"
)

func ID(symbol string, count int) (int, error) {
	if strings.TrimSpace(symbol) == "" {
		return 0, fmt.Errorf("symbol must be a non-empty string")
	}
	if count < 1 {
		return 0, fmt.Errorf("partitionCount must be a positive integer")
	}

	// JavaScript bitwise operators truncate to a signed 32-bit integer after
	// every operation and strings are traversed as UTF-16 code units.
	hash := int32(5381)
	for _, codeUnit := range utf16.Encode([]rune(symbol)) {
		hash = (hash << 5) + hash
		hash ^= int32(codeUnit)
	}
	value := int64(hash)
	if value < 0 {
		value = -value
	}
	return int(value % int64(count)), nil
}

func Validate(id, count int) error {
	if count < 1 {
		return fmt.Errorf("partitionCount must be a positive integer")
	}
	if id < 0 || id >= count {
		return fmt.Errorf("partitionId must be an integer >= 0 and < %d", count)
	}
	return nil
}

func QueueName(id int) string { return fmt.Sprintf("order.commands.partition.%d", id) }
func LeaderKey(id int) string { return fmt.Sprintf("matching:leader:partition:%d", id) }
