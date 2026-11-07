package dev.tuneflow

import org.junit.Assert.*
import org.junit.Test

class SearchSuggestionsTest {
    private val history = listOf("2Pac live", "Yo La Tengo", "Radiohead", "2Pac albums", "Live at Leeds")
    @Test fun blankInputShowsRecentSearchesInOrder() {
        assertEquals(history, SearchSuggestions.matches("  ", history))
    }
    @Test fun prefixesRankAheadOfSubstrings() {
        assertEquals(listOf("Live at Leeds", "2Pac live"), SearchSuggestions.matches("live", history))
    }
    @Test fun fuzzySuggestionsMatchTyposAndAbbreviations() {
        assertEquals(listOf("Radiohead"), SearchSuggestions.matches("radiohed", history))
        assertEquals(listOf("Yo La Tengo"), SearchSuggestions.matches("ylt", history))
        assertEquals(listOf("Yo La Tengo"), SearchSuggestions.matches("yo tengo", history))
    }
    @Test fun unrelatedOrShortInputDoesNotMatchEverything() {
        assertTrue(SearchSuggestions.matches("zz", history).isEmpty())
        assertTrue(SearchSuggestions.matches("zzzzzz", history).isEmpty())
    }
}
