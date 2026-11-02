package dev.tuneflow

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

data class Track(val id: String, val title: String, val artist: String, val duration: Long = 0, val artwork: String = "", val blocked: String = "") {
    fun json() = JSONObject().put("video_id", id).put("title", title).put("artist", artist)
        .put("duration_sec", duration).put("thumbnail_url", artwork)
    companion object {
        fun from(v: JSONObject) = Track(v.optString("video_id"), v.optString("title", "Unknown track"),
            v.optString("artist", "").takeUnless { it == "null" } ?: "", v.optLong("duration_sec", 0),
            v.optString("thumbnail_url", "").takeUnless { it == "null" } ?: "",
            v.optString("blocked_reason", "").takeUnless { it == "null" } ?: "")
    }
}
class ApiException(val status: Int, message: String) : IOException(message)
class Api(private val session: Session, private val fixedToken: String? = null, private val fixedServer: String? = null) {
    private val http = OkHttpClient.Builder().connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS).callTimeout(35, TimeUnit.SECONDS).build()
    suspend fun call(path: String, method: String = "GET", body: JSONObject? = null, authenticated: Boolean = true): String {
        val base = fixedServer ?: session.server
        require(base.startsWith("http://") || base.startsWith("https://")) { "Enter the Tuneflow server address" }
        val request = Request.Builder().url("$base/api/$path")
        if (authenticated) request.header("Authorization", "Bearer ${fixedToken ?: session.token}")
        request.method(method, if (method in listOf("POST", "PUT", "PATCH")) (body ?: JSONObject()).toString().toRequestBody("application/json".toMediaType()) else null)
        val call = http.newCall(request.build())
        return suspendCancellableCoroutine { continuation ->
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) { if (continuation.isActive) continuation.resumeWithException(e) }
                override fun onResponse(call: Call, response: Response) {
                    response.use {
                        val result = response.body.string()
                        if (!continuation.isActive) return
                        if (response.isSuccessful) continuation.resume(result)
                        else continuation.resumeWithException(ApiException(response.code,
                            runCatching { JSONObject(result).optString("detail", "Request failed") }.getOrDefault("Request failed (${response.code})")))
                    }
                }
            })
        }
    }
    suspend fun obj(path: String, method: String = "GET", body: JSONObject? = null, authenticated: Boolean = true) = JSONObject(call(path, method, body, authenticated))
    suspend fun array(path: String) = JSONArray(call(path))
    companion object { fun encode(value: String): String = java.net.URLEncoder.encode(value, "UTF-8") }
}
