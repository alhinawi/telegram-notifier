/**
 * Internationalization (i18n) Module for Telegram Notifier
 * Dynamically loads locales from locales/ directory and provides translation lookup with fallbacks.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function findLocalesDir() {
  const candidates = [
    path.resolve(__dirname, '..', 'locales'),
    path.resolve(__dirname, 'locales'),
    path.resolve(__dirname, '..', 'skills', 'telegram-notifier', 'locales'),
    path.join(os.homedir(), '.gemini', 'config', 'plugins', 'telegram-notifier', 'locales'),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        return dir;
      }
    } catch {
      // Ignore
    }
  }
  return path.resolve(__dirname, '..', 'locales');
}

const localesCache = new Map();

function loadLocaleFile(lang) {
  if (localesCache.has(lang)) {
    return localesCache.get(lang);
  }

  const dir = findLocalesDir();
  const filePath = path.join(dir, `${lang}.json`);
  let data = null;

  if (fs.existsSync(filePath)) {
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.warn(`[i18n] Failed to parse locale file ${filePath}: ${e.message}`);
    }
  }

  if (!data && lang.includes('-')) {
    // e.g. ar-eg -> ar
    const base = lang.split('-')[0];
    data = loadLocaleFile(base);
  }

  if (!data && lang !== 'en') {
    data = loadLocaleFile('en');
  }

  localesCache.set(lang, data || {});
  return data || {};
}

function deepMerge(target, source) {
  const output = { ...target };
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    Object.keys(source).forEach((key) => {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (!(key in target)) {
          output[key] = source[key];
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        output[key] = source[key];
      }
    });
  }
  return output;
}

function getLocale(lang = 'en') {
  const enData = loadLocaleFile('en');
  if (lang === 'en') return enData;
  const targetData = loadLocaleFile(lang);
  return deepMerge(enData, targetData);
}

function getAvailableLanguages() {
  const dir = findLocalesDir();
  if (!fs.existsSync(dir)) {
    return [{ code: 'en', name: 'English', nativeName: 'English' }];
  }

  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    return files.map((file) => {
      const code = path.basename(file, '.json');
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        return {
          code,
          name: parsed._name || code,
          nativeName: parsed._nativeName || parsed._name || code,
        };
      } catch {
        return { code, name: code, nativeName: code };
      }
    });
  } catch {
    return [{ code: 'en', name: 'English', nativeName: 'English' }];
  }
}

function t(keyPath, lang = 'en', params = {}) {
  const locale = getLocale(lang);
  const parts = keyPath.split('.');
  let val = locale;

  for (const part of parts) {
    if (val && typeof val === 'object' && part in val) {
      val = val[part];
    } else {
      val = undefined;
      break;
    }
  }

  if (val === undefined) {
    return keyPath;
  }

  if (typeof val === 'string') {
    return val.replace(/{(\w+)}/g, (match, paramKey) => {
      return params[paramKey] !== undefined ? params[paramKey] : match;
    });
  }

  return val;
}

/**
 * Copy locales directory to a destination parent directory (creates destParentDir/locales)
 */
function copyLocales(destParentDir) {
  const srcDir = findLocalesDir();
  if (!fs.existsSync(srcDir)) return false;
  const targetDir = path.join(destParentDir, 'locales');
  fs.mkdirSync(targetDir, { recursive: true });
  const entries = fs.readdirSync(srcDir);
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry);
    const destPath = path.join(targetDir, entry);
    if (fs.statSync(srcPath).isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      fs.readdirSync(srcPath).forEach((sub) => {
        fs.copyFileSync(path.join(srcPath, sub), path.join(destPath, sub));
      });
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
  return true;
}

module.exports = {
  findLocalesDir,
  getAvailableLanguages,
  getLocale,
  copyLocales,
  t,
};

