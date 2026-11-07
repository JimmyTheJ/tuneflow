plugins { id("com.android.application") }
android {
    namespace = "dev.tuneflow"
    compileSdk = 37
    defaultConfig {
        applicationId = "com.tuneflow.app"
        minSdk = 26
        targetSdk = 36
        versionCode = providers.gradleProperty("buildNumber").getOrElse("405000").toInt()
        versionName = "0.4.5"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
    buildTypes {
        getByName("debug") { versionNameSuffix = "-native-debug" }
        getByName("release") { isMinifyEnabled = true; proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro") }
    }
}
dependencies {
    implementation("androidx.recyclerview:recyclerview:1.4.0")
    implementation("androidx.media3:media3-exoplayer:1.11.1")
    implementation("androidx.media3:media3-session:1.11.1")
    implementation("androidx.media3:media3-datasource:1.11.1")
    implementation("androidx.media3:media3-database:1.11.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    implementation("com.squareup.okhttp3:okhttp:5.5.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20251224")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
}
