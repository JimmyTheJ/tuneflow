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
    @Test fun indexStartsWithSpecialThenDigitsThenAlphabet() {
        assertEquals(37, LibraryLetters.keys.size)
        assertEquals(listOf("#", "0", "1"), LibraryLetters.keys.take(3))
        assertEquals(listOf("X", "Y", "Z"), LibraryLetters.keys.takeLast(3))
    }
}
