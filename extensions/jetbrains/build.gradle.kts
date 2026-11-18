import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.jetbrains.intellij.platform.gradle.TestFrameworkType

plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.1.20"
    id("org.jetbrains.intellij.platform") version "2.10.4"
}

group = "com.algotricz"
version = providers.gradleProperty("pluginVersion").get()

kotlin { jvmToolchain(21) }

repositories {
    mavenCentral()
    intellijPlatform { defaultRepositories() }
}

dependencies {
    intellijPlatform {
        // Built against IntelliJ IDEA Community; the plugin only uses the shared platform, so the same build
        // runs in PyCharm, WebStorm, PhpStorm, GoLand, Rider, CLion, RubyMine, Android Studio and the rest.
        intellijIdeaCommunity(providers.gradleProperty("platformVersion"))
        testFramework(TestFrameworkType.Platform)
        pluginVerifier()
        zipSigner()
    }
    testImplementation("junit:junit:4.13.2")
}

intellijPlatform {
    pluginConfiguration {
        version = providers.gradleProperty("pluginVersion")
        ideaVersion {
            sinceBuild = providers.gradleProperty("sinceBuild")
            untilBuild = provider { null } // no upper bound: keep working in new IDE versions
        }
        changeNotes = provider { file("CHANGELOG.md").readText().substringAfter("## ").substringAfter("\n").substringBefore("\n## ").trim().lines().joinToString("") { "<p>${it.removePrefix("- ")}</p>" } }
    }
    pluginVerification {
        ides {
            // The IDEs people asked about, at the oldest supported version and the newest one.
            create(IntelliJPlatformType.IntellijIdeaCommunity, providers.gradleProperty("platformVersion"))
            create(IntelliJPlatformType.PyCharmCommunity, providers.gradleProperty("platformVersion"))
            create(IntelliJPlatformType.WebStorm, providers.gradleProperty("platformVersion"))
            recommended()
        }
    }
    publishing {
        token = providers.environmentVariable("JETBRAINS_MARKETPLACE_TOKEN")
    }
    signing {
        certificateChain = providers.environmentVariable("JETBRAINS_CERTIFICATE_CHAIN")
        privateKey = providers.environmentVariable("JETBRAINS_PRIVATE_KEY")
        password = providers.environmentVariable("JETBRAINS_PRIVATE_KEY_PASSWORD")
    }
}

tasks {
    test { useJUnit() }
}
