package dev.tuneflow

import org.junit.Assert.*
import org.junit.Test

class LibraryLettersTest {
    @Test fun everyDigitHasItsOwnGroup() {
        assertEquals((0..9).map(Int::toString), ('0'..'9').map { LibraryLetters.initial("$it artists") })
    }
    @Test fun lettersIgnoreAsciiCaseAndSurroundingWhitespace() {
        assertEquals("A", LibraryLetters.initial("  alpha "))
        assertEquals("Z", LibraryLetters.initial("Zebra"))
    }
    @Test fun specialCharactersAndNonLatinInitialsShareOneGroup() {
        for (value in listOf("!Artist", "_Album", "Édith", "東京", "Kelvin", "", "   "))
            assertEquals(value, "#", LibraryLetters.initial(value))
    }
    @Test fun indexStartsWithAlphabetThenDigitsThenSpecial() {
        assertEquals(37, LibraryLetters.keys.size)
        assertEquals(listOf("A", "B", "C"), LibraryLetters.keys.take(3))
        assertEquals(listOf("8", "9", "#"), LibraryLetters.keys.takeLast(3))
    }
}
