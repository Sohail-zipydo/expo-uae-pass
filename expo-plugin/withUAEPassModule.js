/**
 * Expo Config Plugin: Add UAE Pass Native Module
 * Package: expo-uae-pass
 * 
 * This plugin automatically adds the UAE Pass native module to Android projects
 * Creates Kotlin files for checking if UAE Pass app is installed
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Kotlin code for UAE Pass Module
 * Note: Package name will be dynamically determined from the project
 */
const UAEPassModuleKt = `package PACKAGE_NAME_PLACEHOLDER

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class UAEPassModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "UAEPassModule"
    }

    @ReactMethod
    fun isUAEPassInstalled(packageName: String, promise: Promise) {
        try {
            val pm = reactApplicationContext.packageManager
            pm.getApplicationInfo(packageName, 0)
            promise.resolve(true)
        } catch (e: PackageManager.NameNotFoundException) {
            promise.resolve(false)
        } catch (e: Exception) {
            promise.reject("ERROR", "Error checking app installation: \${e.message}", e)
        }
    }

    @ReactMethod
    fun launchUAEPassApp(packageName: String, deepLinkUrl: String, promise: Promise) {
        try {
            val activity = reactApplicationContext.currentActivity
            if (activity == null) {
                promise.reject("ERROR", "Activity is null")
                return
            }

            // Try to launch with deep link first
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(deepLinkUrl))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            
            // Try to set the package to ensure it opens in UAE Pass app
            try {
                val pm = reactApplicationContext.packageManager
                pm.getApplicationInfo(packageName, 0)
                intent.setPackage(packageName)
            } catch (e: PackageManager.NameNotFoundException) {
                // Package not found, try without package restriction
            }

            activity.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", "Error launching UAE Pass app: \${e.message}", e)
        }
    }

    @ReactMethod
    fun openUAEPassWithIntent(authUrl: String, callbackUrl: String, packageName: String, promise: Promise) {
        try {
            val activity = reactApplicationContext.currentActivity
            if (activity == null) {
                promise.reject("ERROR", "Activity is null")
                return
            }

            // Create intent to open UAE Pass app with the authorization URL
            val scheme = if (packageName.contains(".stg")) "uaepassstg" else "uaepass"
            
            // Build the UAE Pass deep link with callback URLs
            val successCallback = Uri.encode(callbackUrl)
            val failureCallback = Uri.encode(callbackUrl + "?error=cancelled")
            
            val uaePassUrl = "\${scheme}://idshub/authorize?" +
                "spUrl=" + Uri.encode(authUrl) +
                "&successURL=" + successCallback +
                "&failureURL=" + failureCallback

            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uaePassUrl))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            intent.setPackage(packageName)

            activity.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            // If direct launch fails, try with just the scheme
            try {
                val scheme = if (packageName.contains(".stg")) "uaepassstg" else "uaepass"
                val fallbackIntent = Intent(Intent.ACTION_VIEW, Uri.parse("\${scheme}://"))
                fallbackIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactApplicationContext.currentActivity?.startActivity(fallbackIntent)
                promise.resolve(true)
            } catch (e2: Exception) {
                promise.reject("ERROR", "Error launching UAE Pass: \${e2.message}", e2)
            }
        }
    }
}
`;

/**
 * Kotlin code for UAE Pass Package
 */
const UAEPassPackageKt = `package PACKAGE_NAME_PLACEHOLDER

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class UAEPassPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(UAEPassModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
`;

/**
 * Get package name from Android project
 */
function getPackageName(projectRoot) {
  try {
    const buildGradlePath = path.join(projectRoot, 'android', 'app', 'build.gradle');
    if (fs.existsSync(buildGradlePath)) {
      const content = fs.readFileSync(buildGradlePath, 'utf-8');
      const match = content.match(/namespace\s+['"]([^'"]+)['"]/) || content.match(/applicationId\s+['"]([^'"]+)['"]/);
      if (match) {
        return match[1];
      }
    }
  } catch (error) {
    console.warn('Could not read package name from build.gradle:', error);
  }
  
  // Fallback to default
  return 'com.yourapp';
}

/**
 * Convert package name to directory path
 */
function packageToPath(packageName) {
  return packageName.split('.').join(path.sep);
}

/**
 * Recursively find a file by name under a directory
 */
function findFile(dir, filename) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name === filename) return full;
    if (e.isDirectory()) {
      const found = findFile(full, filename);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Read app package from MainApplication.kt (package declaration)
 */
function getPackageFromMainApplication(content) {
  const m = content.match(/package\s+([\w.]+)/);
  return m ? m[1] : null;
}

/**
 * Add UAE Pass native module files to Android project
 */
function withUAEPassModule(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const androidSrcRoot = path.join(projectRoot, 'android', 'app', 'src');

      // 1) Find MainApplication.kt first (Expo/RN can put it under any package path)
      const mainApplicationPath = findFile(androidSrcRoot, 'MainApplication.kt');
      let appPackage = null;
      let mainApplicationContent = '';

      if (mainApplicationPath) {
        mainApplicationContent = fs.readFileSync(mainApplicationPath, 'utf-8');
        appPackage = getPackageFromMainApplication(mainApplicationContent);
      }

      // 2) Resolve app package: from MainApplication.kt > build.gradle > fallback
      if (!appPackage) {
        appPackage = getPackageName(projectRoot);
      }
      const uaePassSubpackage = appPackage + '.uaepass';
      const uaePassPackagePath = packageToPath(uaePassSubpackage);

      const androidJavaRoot = path.join(androidSrcRoot, 'main', 'java');
      const moduleDir = path.join(androidJavaRoot, uaePassPackagePath);

      // Ensure directory exists
      if (!fs.existsSync(moduleDir)) {
        fs.mkdirSync(moduleDir, { recursive: true });
      }

      // Replace package name placeholder (use uaepass subpackage so we don't overwrite app files)
      const moduleCode = UAEPassModuleKt.replace(/PACKAGE_NAME_PLACEHOLDER/g, uaePassSubpackage);
      const packageCode = UAEPassPackageKt.replace(/PACKAGE_NAME_PLACEHOLDER/g, uaePassSubpackage);

      // Write UAEPassModule.kt and UAEPassPackage.kt in subpackage
      fs.writeFileSync(path.join(moduleDir, 'UAEPassModule.kt'), moduleCode, 'utf-8');
      fs.writeFileSync(path.join(moduleDir, 'UAEPassPackage.kt'), packageCode, 'utf-8');
      console.log('✅ Created UAEPassModule.kt and UAEPassPackage.kt in', uaePassSubpackage);

      // 3) Patch MainApplication.kt to register UAEPassPackage
      const importStatement = `import ${uaePassSubpackage}.UAEPassPackage`;
      const addStatement = 'packages.add(UAEPassPackage())';
      const alreadyHasRegistration =
        mainApplicationContent.includes('UAEPassPackage()') ||
        mainApplicationContent.includes('UAEPassPackage ()');

      if (!mainApplicationPath) {
        console.warn('⚠️  MainApplication.kt not found under android/app/src. Please manually register UAEPassPackage.');
        return config;
      }

      if (alreadyHasRegistration) {
        console.log('✅ UAEPassPackage already registered in MainApplication.kt');
        return config;
      }

      // Add import after PackageList or any react import (handle \r\n)
      if (!mainApplicationContent.includes(importStatement)) {
        if (mainApplicationContent.includes('import com.facebook.react.PackageList')) {
          mainApplicationContent = mainApplicationContent.replace(
            /(import com\.facebook\.react\.PackageList)\s*[\r\n]+/,
            `$1\n${importStatement}\n`
          );
        } else if (mainApplicationContent.includes('import com.facebook.react.soloader.OpenSourceMergedSoMapping')) {
          mainApplicationContent = mainApplicationContent.replace(
            /(import com\.facebook\.react\.soloader\.OpenSourceMergedSoMapping)\s*[\r\n]+/,
            `$1\n${importStatement}\n`
          );
        } else {
          mainApplicationContent = mainApplicationContent.replace(
            /(package\s+[\w.]+)\s*[\r\n]+\s*[\r\n]+/,
            `$1\n\n${importStatement}\n\n`
          );
        }
      }

      // Register package: insert packages.add(UAEPassPackage()) right after "val packages = PackageList(this).packages"
      // Works with any number of comment lines between that and "return packages"
      const valPackagesRegex = /(val packages = PackageList\(this\)\.packages)(\s*[\r\n]+)/;
      if (valPackagesRegex.test(mainApplicationContent)) {
        mainApplicationContent = mainApplicationContent.replace(
          valPackagesRegex,
          '$1\n            packages.add(UAEPassPackage())$2'
        );
        fs.writeFileSync(mainApplicationPath, mainApplicationContent, 'utf-8');
        console.log('✅ Registered UAEPassPackage in MainApplication.kt');
      } else if (/PackageList\(this\)\.packages\.apply\s*\{/.test(mainApplicationContent)) {
        mainApplicationContent = mainApplicationContent.replace(
          /(PackageList\(this\)\.packages\.apply\s*\{\s*)[\r\n]+/,
          `$1\n            ${addStatement}\n            `
        );
        fs.writeFileSync(mainApplicationPath, mainApplicationContent, 'utf-8');
        console.log('✅ Registered UAEPassPackage in MainApplication.kt (apply block)');
      } else {
        console.warn('⚠️  Could not auto-register UAEPassPackage. Add manually to MainApplication.kt:');
        console.warn(`   ${importStatement}`);
        console.warn(`   ${addStatement}`);
      }

      return config;
    },
  ]);
}

module.exports = withUAEPassModule;

