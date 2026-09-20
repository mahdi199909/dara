// Validation for money amounts, shared by the web routes and the on-device repositories.
//
// Money is whole Toman held in a double-precision column (see the note at the top of
// prisma/schema.prisma). Every integer up to 2^53 is exact there, and zod's `.int()` alone would
// let a value as absurd as 1e300 through (Number.isInteger(1e300) is true), which no chart, sum
// or `toLocaleString` can represent sensibly. The cap is 999,999,999,999,999 Toman (~1e15,
// about a million billion): far beyond anything a person tracks, and low enough that summing
// thousands of rows still stays exact.
import { z } from "zod";
import { MAX_MONEY_TOMAN } from "@/lib/money";

/** A whole-Toman amount, at most MAX_MONEY_TOMAN. Chain `.min(0)`, `.positive()`, `.optional()`… as usual. */
export const tomanInt = () => z.number().int().max(MAX_MONEY_TOMAN, "مبلغ بیش از حد بزرگ است.");
