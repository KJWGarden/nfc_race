// TODO-002: unit check of the shared static-URL parsers used by the /race Web NFC scan and the pending handler.
// Run: node nfc-parse-check.mjs   (imports src/lib/nfc.ts directly; Node strips the TS types)
import { parseStaticTagUrl, parseSunUrl, toStaticParams } from "/Users/kimgarden/dev/nfc-walk-race/src/lib/nfc.ts";

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label} -> ${JSON.stringify(actual)}`);
}
const E = "0".repeat(32);
const C = "0".repeat(16);

check("static URL", parseStaticTagUrl("https://race.example/t/ab12cd34ef"), { token: "ab12cd34ef" });
check("static URL, trailing slash + spaces", parseStaticTagUrl("  https://race.example/t/ab12cd34ef/ "), { token: "ab12cd34ef" });
check("static URL upper case -> lowercased", parseStaticTagUrl("https://race.example/t/AB12CD34EF"), { token: "ab12cd34ef" });
check("static URL with unrelated query", parseStaticTagUrl("https://race.example/t/ab12cd34ef?x=1"), { token: "ab12cd34ef" });
check("SUN URL is not a static URL", parseStaticTagUrl(`https://race.example/t/s?e=${E}&c=${C}`), null);
check("SUN URL still parsed as SUN", parseSunUrl(`https://race.example/t/s?e=${E}&c=${C}`), { e: E, c: C });
check("static URL is not a SUN URL", parseSunUrl("https://race.example/t/ab12cd34ef"), null);
check("short token", parseStaticTagUrl("https://race.example/t/abc"), null);
check("11-char token", parseStaticTagUrl("https://race.example/t/ab12cd34efg"), null);
check("/t/s without params", parseStaticTagUrl("https://race.example/t/s"), null);
check("other path", parseStaticTagUrl("https://race.example/join/ab12cd34ef"), null);
check("nested path", parseStaticTagUrl("https://race.example/x/t/ab12cd34ef"), null);
check("relative / not a URL", parseStaticTagUrl("/t/ab12cd34ef"), null);
check("plain text record", parseStaticTagUrl("hello"), null);
check("pending token ok", toStaticParams("AB12cd34ef"), { token: "ab12cd34ef" });
check("pending token wrong type", toStaticParams(12345), null);
check("pending token wrong length", toStaticParams("abc"), null);
check("pending token bad chars", toStaticParams("ab12cd34e!"), null);
console.log(failures === 0 ? "ALL PASS" : `FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
