package dev.tuneflow

import android.content.Context
import org.json.JSONArray

/** Device-local search state, isolated by server and account. */
class SearchHistory(context: Context, account: String) {
    private val identity = java.security.MessageDigest.getInstance("SHA-256").digest(account.toByteArray()).joinToString("") { "%02x".format(it) }
    private val prefs = context.getSharedPreferences("search-$identity", Context.MODE_PRIVATE)
    var rememberResults: Boolean
        get() = prefs.getBoolean("remember", true)
        set(value) { prefs.edit().putBoolean("remember", value).apply(); if (!value) clearResults() }
    var draft: String
        get() = prefs.getString("draft", "").orEmpty()
        set(value) { prefs.edit().putString("draft", value).apply() }
    var resultQuery: String
        get() = prefs.getString("query", "").orEmpty()
        set(value) { prefs.edit().putString("query", value).apply() }
    var results: List<Track>
        get() = runCatching { val a = JSONArray(prefs.getString("results", "[]")); (0 until a.length()).map { Track.from(a.getJSONObject(it)) } }.getOrDefault(emptyList())
        set(value) { prefs.edit().putString("results", JSONArray(value.map { it.json() }).toString()).apply() }
    fun recent(): List<String> = runCatching {
        val a = JSONArray(prefs.getString("history", "[]")); (0 until a.length()).map { a.getString(it) }
    }.getOrDefault(emptyList())
    fun record(query: String) {
        val value = query.trim().take(300)
        if (value.isEmpty()) return
        save((listOf(value) + recent().filterNot { it.equals(value, true) }).take(30))
    }
    fun remove(query: String) = save(recent().filterNot { it.equals(query, true) })
    fun clearHistory() = save(emptyList())
    fun clearResults() { prefs.edit().remove("draft").remove("query").remove("results").apply() }
    private fun save(values: List<String>) { prefs.edit().putString("history", JSONArray(values).toString()).apply() }
}

/** Prefix, substring, word abbreviations and small spelling mistakes, ranked by recency. */
object SearchSuggestions {
    fun matches(input: String, history: List<String>): List<String> {
        val needle = input.trim().lowercase()
        if (needle.isEmpty()) return history.take(12)
        fun score(value: String): Int {
            val text = value.lowercase()
            if (text.startsWith(needle)) return 0
            if (text.contains(needle)) return 1
            if (needle.length < 3) return 99
            if (needle.split(Regex("\\s+")).all { token -> text.split(Regex("\\s+")).any { word ->
                word.startsWith(token) || (token.length >= 3 && distance(token, word) <= if (token.length > 5) 2 else 1)
            } }) return 2
            var cursor = 0
            for (letter in text) if (cursor < needle.length && letter == needle[cursor]) cursor++
            return if (cursor == needle.length) 3 else 99
        }
        return history.mapIndexed { index, value -> Triple(value, score(value), index) }
            .filter { it.second < 99 }.sortedWith(compareBy({ it.second }, { it.third })).take(8).map { it.first }
    }
    private fun distance(a: String, b: String): Int {
        var row = IntArray(b.length + 1) { it }
        for (i in a.indices) {
            val next = IntArray(b.length + 1); next[0] = i + 1
            for (j in b.indices) next[j + 1] = minOf(next[j] + 1, row[j + 1] + 1, row[j] + if (a[i] == b[j]) 0 else 1)
            row = next
        }
        return row[b.length]
    }
}
