import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import org.jetbrains.intellij.platform.gradle.tasks.VerifyPluginTask.FailureLevel

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
        // Fail CI on anything Marketplace would flag, not only on outright incompatibility.
        failureLevel = listOf(FailureLevel.COMPATIBILITY_PROBLEMS, FailureLevel.INTERNAL_API_USAGES, FailureLevel.SCHEDULED_FOR_REMOVAL_API_USAGES, FailureLevel.DEPRECATED_API_USAGES)
        ides {
            // The IDEs people asked about, at the oldest supported version and the newest one.
            create(IntelliJPlatformType.IntellijIdeaCommunity, providers.gradleProperty("platformVersion"))
            create(IntelliJPlatformType.PyCharmCommunity, providers.gradleProperty("platformVersion"))
            create(IntelliJPlatformType.WebStorm, providers.gradleProperty("platformVersion"))
            recommended()
            // From 2025.3 IntelliJ IDEA is one product (no separate Community edition): check the newest release too.
            create(IntelliJPlatformType.IntellijIdeaUltimate, "2026.3")
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
