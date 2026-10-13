// Venera-Next's real Flutter/QuickJS source runtime; no Node mocks.
// This test is copied to upstream test/ and run with flutter test on Linux.
// Public read-only access only. Binary media stays in a temporary directory.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rhttp/rhttp.dart' as rhttp;
import 'package:venera_next/features/comic_source/models.dart';
import 'package:venera_next/features/comic_source/parser.dart';
import 'package:venera_next/features/comic_source/source.dart';
import 'package:venera_next/foundation/app.dart';
import 'package:venera_next/foundation/appdata.dart';
import 'package:venera_next/foundation/cache_manager.dart';
import 'package:venera_next/foundation/js_engine.dart';
import 'package:venera_next/foundation/log.dart';
import 'package:venera_next/foundation/res.dart';
import 'package:venera_next/network/images.dart';

class _AllowHttp extends HttpOverrides {}
final sources = <String, ComicSource>{};
final results = <Map<String, Object?>>[];
Directory? tempDir;
HttpOverrides? previousHttp;
bool engineReady = false;
final siteFilter = Platform.environment['VENERA_LIVE_SITE'] ?? 'both';
final shouldDownload = Platform.environment['VENERA_LIVE_DOWNLOAD'] != 'false';
final inputDir = Platform.environment['VENERA_SOURCES_DIR'] ?? '../sources';
final reportDir = Platform.environment['VENERA_LIVE_REPORT_DIR'] ?? '../sources/reports';

String safeError(Object error) {
  var text = error.toString().replaceAll(RegExp(r'https?://[^\s\)]+'), '<remote-url>');
  text = text.replaceAll(RegExp(r'(authorization|cookie|token|secret|apikey)\s*[:=]\s*[^\s,;]+', caseSensitive: false), '<redacted>');
  text = text.replaceAll(RegExp(r'[\r\n|]+'), ' ');
  return text.length > 250 ? text.substring(0, 250) : text;
}

void note(String site, String step, String status, String detail, int milliseconds) {
  results.add({'source': site, 'step': step, 'status': status,
    'milliseconds': milliseconds, 'detail': detail.replaceAll('|', '/')});
  print(status + ' ' + site + '/' + step + ' (' + milliseconds.toString() + ' ms) ' + detail);
}
void skip(String site, String step, String why) => note(site, step, 'SKIP', why, 0);

Future<T?> run<T>(String site, String step, Future<T> Function() operation,
    {Duration timeout = const Duration(seconds: 75), String Function(T)? describe}) async {
  final timer = Stopwatch()..start();
  try {
    final value = await operation().timeout(timeout);
    note(site, step, 'PASS', describe == null ? '' : describe(value), timer.elapsedMilliseconds);
    return value;
  } catch (error) {
    note(site, step, 'FAIL', safeError(error), timer.elapsedMilliseconds);
    return null;
  }
}

List<Comic> valid(Res<List<Comic>> response) {
  response.throwIfError();
  final comics = response.data;
  expect(comics, isNotEmpty);
  expect(comics.first.title, isNotEmpty);
  expect(comics.first.id, isNotEmpty);
  expect(comics.first.cover, isNotEmpty);
  return comics;
}

Future<Res<List<Comic>>> explore(ExplorePageData e, [String? cursor]) {
  if (e.loadNext != null) return e.loadNext!(cursor);
  if (e.loadPage != null) return e.loadPage!(cursor == null ? 1 : 2);
  throw StateError('Explore has no page loader');
}

String? imageType(Uint8List data) {
  if (data.length < 12) return null;
  if (data[0] == 255 && data[1] == 216 && data[2] == 255) return 'jpeg';
  if (data[0] == 137 && data[1] == 80 && data[2] == 78 && data[3] == 71) return 'png';
  final a = ascii.decode(data.sublist(0, 4), allowInvalid: true);
  if (a == 'GIF8') return 'gif';
  if (a == 'RIFF' && ascii.decode(data.sublist(8, 12), allowInvalid: true) == 'WEBP') return 'webp';
  if (ascii.decode(data.sublist(4, 8), allowInvalid: true) == 'ftyp') return 'avif/heif';
  return null;
}

Future<String> downloaded(Stream<ImageDownloadProgress> progress) async {
  Uint8List? image;
  await for (final part in progress) {
    if (part.imageBytes != null) image = part.imageBytes;
  }
  if (image == null || image.length < 1024) {
    throw StateError('Venera downloader did not return complete image bytes');
  }
  final type = imageType(image);
  if (type == null) throw StateError('Image payload is not JPEG/PNG/WebP/GIF/AVIF (possible challenge)');
  return type + ', ' + image.length.toString() + ' bytes';
}

Future<void> checkSource(String key) async {
  final src = await run<ComicSource>(key, 'import into Venera', () async {
    final file = File(inputDir + '/' + key + '.js');
    expect(await file.exists(), isTrue);
    final s = await ComicSourceParser().parse(await file.readAsString(), file.absolute.path);
    await s.initializeRuntime();
    expect(s.key, key);
    sources[key] = s;
    return s;
  }, describe: (s) => s.key + ' v' + s.version);
  if (src == null) throw StateError('Real Venera source import failed for ' + key);

  const keyword = 'landscape';
  final found = await run<Res<List<Comic>>>(key, 'search', () async {
    final s = src.searchPageData ?? (throw StateError('Search is missing'));
    final defaults = s.searchOptions?.map((e) => e.defaultValue).toList() ?? <String>[];
    final r = s.loadPage != null ? await s.loadPage!(keyword, 1, defaults)
        : await s.loadNext!(keyword, null, defaults);
    valid(r);
    return r;
  }, describe: (r) => r.data.length.toString() + ' results');

  final l = src.explorePages.where((p) => p.title.toLowerCase().contains('latest'));
  final latestPage = l.isEmpty ? null : l.first;
  final latest = await run<Res<List<Comic>>>(key, 'latest', () async {
    if (latestPage == null) throw StateError('Latest explorer missing');
    final r = await explore(latestPage);
    valid(r);
    return r;
  }, describe: (r) => r.data.length.toString() + ' items');
  if (latest == null || latestPage == null) {
    skip(key, 'latest next page', 'latest failed');
  } else if (latestPage.loadNext != null && (latest.subData == null || latest.subData == '')) {
    skip(key, 'latest next page', 'no next cursor');
  } else if (latestPage.loadPage != null && latest.subData is num && (latest.subData as num) < 2) {
    skip(key, 'latest next page', 'one page only');
  } else {
    await run<int>(key, 'latest next page', () async {
      final r = await explore(latestPage, latest.subData?.toString() ?? '2');
      return valid(r).length;
    }, describe: (n) => n.toString() + ' items');
  }

  await run<int>(key, 'popular', () async {
    final matches = src.explorePages.where((e) => e.title.toLowerCase().contains('popular'));
    if (matches.isEmpty) throw StateError('Popular explorer missing');
    final page = matches.first;
    int n;
    if (page.loadMultiPart != null) {
      final r = await page.loadMultiPart!();
      r.throwIfError();
      n = r.data.fold<int>(0, (total, part) => total + part.comics.length);
    } else {
      n = valid(await explore(page)).length;
    }
    expect(n, greaterThan(0));
    return n;
  }, describe: (n) => n.toString() + ' items');

  await run<int>(key, 'ranking', () async {
    final ranking = src.categoryComicsData?.rankingData ??
        (throw StateError('Rankings missing'));
    expect(ranking.options, isNotEmpty);
    final option = ranking.options.keys.first;
    final r = ranking.load != null ? await ranking.load!(option, 1)
        : await ranking.loadWithNext!(option, null);
    return valid(r).length;
  }, describe: (n) => n.toString() + ' ranked items');

  final candidates = <Comic>[...?found?.dataOrNull, ...?latest?.dataOrNull];
  candidates.sort((a, b) => (a.maxPage ?? 999999).compareTo(b.maxPage ?? 999999));
  if (candidates.isEmpty) {
    for (final step in ['details', 'read pages', 'download cover', 'download first page']) {
      skip(key, step, 'No public gallery available');
    }
  } else {
    final comic = candidates.first;
    final details = await run<ComicDetails>(key, 'details', () async {
      final r = await src.loadComicInfo!(comic.id);
      r.throwIfError();
      final value = r.data;
      expect(value.title, isNotEmpty);
      expect(value.cover, isNotEmpty);
      expect(value.tags, isA<Map<String, List<String>>>());
      return value;
    }, describe: (d) => d.tags.length.toString() + ' tag groups');

    final pages = await run<List<String>>(key, 'read pages', () async {
      final r = await src.loadComicPages!(comic.id, null);
      r.throwIfError();
      expect(r.data, isNotEmpty);
      expect(r.data.first, startsWith('https://'));
      return r.data;
    }, timeout: const Duration(seconds: 100),
      describe: (urls) => urls.length.toString() + ' pages');

    if (!shouldDownload) {
      skip(key, 'download cover', 'disabled');
      skip(key, 'download first page', 'disabled');
    } else {
      if (details != null) {
        await run<String>(key, 'download cover', () => downloaded(
          ImageDownloader.loadThumbnail(details.cover, key, comic.id)),
          timeout: const Duration(seconds: 105), describe: (s) => s);
      } else {
        skip(key, 'download cover', 'details unavailable');
      }
      if (pages != null) {
        await run<String>(key, 'download first page', () => downloaded(
          ImageDownloader.loadComicImage(pages.first, key, comic.id, '')),
          timeout: const Duration(seconds: 110), describe: (s) => s);
      } else {
        skip(key, 'download first page', 'reading unavailable');
      }
    }
  }
  final failures = results.where((x) => x['source'] == key && x['status'] == 'FAIL').length;
  expect(failures, 0, reason: key + ' has ' + failures.toString() +
      ' failed live stages. See the JSON and Markdown report.');
}

Future<void> writeReports() async {
  final dir = Directory(reportDir);
  await dir.create(recursive: true);
  await File(dir.path + '/results.json').writeAsString(
    const JsonEncoder.withIndent('  ').convert({
      'engine': 'Real Venera-Next Flutter QuickJS + Rust HTTP + ImageDownloader',
      'utc': DateTime.now().toUtc().toIso8601String(),
      'fullFirstImageDownloads': shouldDownload,
      'results': results,
    }));
  final summary = StringBuffer('## Venera-Next live integration tests\n\n')
    ..writeln('Real QuickJS, source parser, Rust transport, and image downloader. '
        'Not an Android GUI or logged-in-account test.\n')
    ..writeln('Images and gallery titles are not uploaded. Site 403/429 will fail tests.\n')
    ..writeln('| Source | Feature | Result | Duration | Detail |')
    ..writeln('|---|---|---|---:|---|');
  for (final item in results) {
    summary.writeln('| ' + item['source'].toString() + ' | ' +
      item['step'].toString() + ' | ' + item['status'].toString() +
      ' | ' + item['milliseconds'].toString() + ' ms | ' +
      item['detail'].toString() + ' |');
  }
  final text = summary.toString();
  await File(dir.path + '/summary.md').writeAsString(text);
  final stepSummary = Platform.environment['GITHUB_STEP_SUMMARY'];
  if (stepSummary != null && stepSummary.isNotEmpty) {
    await File(stepSummary).writeAsString(text, mode: FileMode.append);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    previousHttp = HttpOverrides.current;
    HttpOverrides.global = _AllowHttp();
    tempDir = await Directory.systemTemp.createTemp('venera-source-live-');
    App.version = '1.18.0';
    App.isInitialized = false; // Headless: no WebView/login UI.
    App.dataPath = tempDir!.path;
    App.cachePath = tempDir!.path;
    final proxy = Platform.environment['VENERA_HTTP_PROXY']?.trim();
    appdata.settings['proxy'] = proxy == null || proxy.isEmpty ? 'direct' : proxy;
    Log.isMuted = true;
    await rhttp.Rhttp.init();
    await JsEngine().init();
    engineReady = true;
    ImageDownloader.configureSourceImageLoading(
      thumbnailLoadingConfig: (key, url) async {
        final getConfig = sources[key]?.getThumbnailLoadingConfig;
        return getConfig == null ? <String, dynamic>{} : await getConfig(url);
      },
      comicImageLoadingConfig: (key, imageKey, comicId, chapterId) async {
        final getConfig = sources[key]?.getImageLoadingConfig;
        return getConfig == null ? <String, dynamic>{}
          : await getConfig(imageKey, comicId, chapterId);
      },
    );
  });
  tearDownAll(() async {
    try {
      await writeReports();
    } finally {
      for (final source in sources.values) {
        source.disposeRuntimeCallbacks();
      }
      if (engineReady) await JsEngine().closeAndWait();
      if (CacheManager.instance != null) await CacheManager.instance!.dispose();
      HttpOverrides.global = previousHttp;
      await tempDir?.delete(recursive: true);
      Log.isMuted = false;
    }
  });
  test('nhentai: real VeneraNext source integration', () => checkSource('nhentai'),
      skip: siteFilter != 'both' && siteFilter != 'nhentai');
  test('ehentai: real VeneraNext source integration', () => checkSource('ehentai'),
      skip: siteFilter != 'both' && siteFilter != 'ehentai');
}
