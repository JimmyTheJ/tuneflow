package dev.tuneflow

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import java.security.KeyStore

/** Credentials stay in Android Keystore encrypted storage, outside Android backups. */
class Session(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("tuneflow-native", Context.MODE_PRIVATE)
    var server: String
        get() = prefs.getString("server", "") ?: ""
        set(value) { prefs.edit().putString("server", value.trim().trimEnd('/')).apply() }
    var userId: String
        get() = prefs.getString("user", "") ?: ""
        set(value) { prefs.edit().putString("user", value).apply() }
    var household: String
        get() = prefs.getString("household", "system") ?: "system"
        set(value) { prefs.edit().putString("household", value).apply() }
    var token: String
        get() {
            val value = prefs.getString("token", null) ?: return ""
            return runCatching {
                val data = Base64.decode(value, Base64.NO_WRAP)
                Cipher.getInstance("AES/GCM/NoPadding").run {
                    init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data.copyOfRange(0, 12)))
                    String(doFinal(data.copyOfRange(12, data.size)), Charsets.UTF_8)
                }
            }.getOrDefault("")
        }
        set(value) {
            if (value.isEmpty()) { prefs.edit().remove("token").apply(); return }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
            prefs.edit().putString("token", Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray()), Base64.NO_WRAP)).apply()
        }
    fun clear() { token = ""; userId = "" }
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("tuneflow-session", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("tuneflow-session", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
}
