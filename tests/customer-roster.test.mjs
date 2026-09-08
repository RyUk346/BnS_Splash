import { customerRoster, customersToCsv } from "../lib/analytics.js";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : (fail++, console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`));
};
const NOW = new Date("2026-09-01T12:00:00+01:00"); // 1 Sep 2026, UK

// Callum from the screenshot: 3 visits, one phone typo, no opt-in
const callum = [
  { timestamp: "2026-08-26T20:59:00+01:00", email: "copestickcallum51@gmail.com", firstName: "Callum",
    phone: "07960972364", birthday: "16/12/1998", branch: "BnS Castle Vale", promo: "No", totalMinutes: 48 },
  { timestamp: "2026-08-29T19:39:00+01:00", email: "copestickcallum51@gmail.com", firstName: "Callum",
    phone: "0796097364", birthday: "16/12/1998", branch: "BnS Castle Vale", promo: "No", totalMinutes: 41 },
  { timestamp: "2026-08-30T22:37:00+01:00", email: "copestickcallum51@gmail.com", firstName: "Callum",
    phone: "07960972364", birthday: "16/12/1998", branch: "BnS Castle Vale", promo: "No", totalMinutes: 43 },
];
let r = customerRoster(callum, NOW);
eq("3 visits collapse to 1 person", r.length, 1);
eq("visit count", r[0].visits, 3);
eq("latest phone wins", r[0].phone, "07960972364");
eq("phone conflict flagged", r[0].conflicts.phone.slice().sort(), ["07960972364","0796097364"].slice().sort());
eq("phone conflict has 2 variants", r[0].conflicts.phone.length, 2);
eq("no birthday conflict", r[0].conflicts.birthday, undefined);
eq("hasConflict", r[0].hasConflict, true);
eq("avg stay", r[0].avgMinutes, 44);
eq("days since (30 Aug -> 1 Sep)", r[0].daysSince, 2);
eq("not opted in", r[0].optedIn, false);
eq("tier", r[0].tier.label, "Regular");
eq("one store", r[0].storeList, ["BnS Castle Vale"]);

// Kiharno: birthday typed 7 Aug once, 7 Sep twice; name Pope/Pop; phone differs
const kiharno = [
  { timestamp: "2026-08-28T00:39:00+01:00", email: "pope.kiharno@icloud.com", firstName: "Kiharno Pop",
    phone: "07897905798", birthday: "07/09/1995", branch: "BnS Castle Vale", promo: "Yes", totalMinutes: 12 },
  { timestamp: "2026-08-30T21:02:00+01:00", email: "pope.kiharno@icloud.com", firstName: "Kiharno Pope",
    phone: "07897905791", birthday: "07/08/1995", branch: "BnS Castle Vale", promo: "Yes", totalMinutes: 84 },
  { timestamp: "2026-08-31T22:40:00+01:00", email: "POPE.Kiharno@icloud.com", firstName: "Kiharno Pope",
    phone: "07897905798", birthday: "07/09/1995", branch: "BnS Perry Barr", promo: "Yes", totalMinutes: 10 },
];
r = customerRoster(kiharno, NOW);
eq("case-insensitive email merges", r.length, 1);
eq("kiharno visits", r[0].visits, 3);
eq("latest birthday wins", r[0].birthday, "07/09/1995");
eq("birthday conflict flagged", r[0].conflicts.birthday.length, 2);
eq("name conflict flagged", r[0].conflicts.name.length, 2);
eq("latest name wins", r[0].name, "Kiharno Pope");
eq("opted in", r[0].optedIn, true);
eq("both stores", r[0].storeList, ["BnS Castle Vale","BnS Perry Barr"]);
eq("birthdayIn 7 Sep from 1 Sep", r[0].birthdayIn, 6);

// A blank on the newest visit must not wipe an earlier good value
const blanks = [
  { timestamp: "2026-08-01T10:00:00+01:00", email: "a@b.com", firstName: "Ann", phone: "07000000001", birthday: "01/01/1990" },
  { timestamp: "2026-08-20T10:00:00+01:00", email: "a@b.com", firstName: "Ann", phone: "", birthday: "" },
];
r = customerRoster(blanks, NOW);
eq("blank does not erase phone", r[0].phone, "07000000001");
eq("blank does not erase birthday", r[0].birthday, "01/01/1990");
eq("blank creates no conflict", r[0].hasConflict, false);

// Phone written three legal ways = same number, no conflict
const phoneForms = [
  { timestamp: "2026-08-01T10:00:00+01:00", email: "p@b.com", firstName: "P", phone: "+447700900123" },
  { timestamp: "2026-08-02T10:00:00+01:00", email: "p@b.com", firstName: "P", phone: "07700 900123" },
  { timestamp: "2026-08-03T10:00:00+01:00", email: "p@b.com", firstName: "P", phone: "(07700) 900123" },
];
r = customerRoster(phoneForms, NOW);
eq("phone formatting is not a conflict", r[0].hasConflict, false);
eq("latest raw phone kept", r[0].phone, "(07700) 900123");

// Birthday with and without a year is not a conflict
const bdayYear = [
  { timestamp: "2026-08-01T10:00:00+01:00", email: "y@b.com", firstName: "Y", birthday: "14/03" },
  { timestamp: "2026-08-02T10:00:00+01:00", email: "y@b.com", firstName: "Y", birthday: "14/03/1990" },
];
r = customerRoster(bdayYear, NOW);
eq("year added later is not a conflict", r[0].hasConflict, false);
eq("richer value kept", r[0].birthday, "14/03/1990");

// No email -> identity falls back to the device
const noEmail = [
  { timestamp: "2026-08-01T10:00:00+01:00", mac: "AA:BB:CC:DD:EE:FF", firstName: "Walk-in" },
  { timestamp: "2026-08-05T10:00:00+01:00", mac: "aa:bb:cc:dd:ee:ff", firstName: "Walk-in" },
];
r = customerRoster(noEmail, NOW);
eq("mac fallback merges case-insensitively", r.length, 1);
eq("mac fallback visits", r[0].visits, 2);

// Junk rows must not create a phantom customer
r = customerRoster([{ timestamp: "2026-08-01T10:00:00+01:00" }, { timestamp: "bad", email: "x@y.com" }], NOW);
eq("no email and no mac is skipped", r.length, 0);

// Sorting: most recent first
r = customerRoster([...callum, ...kiharno], NOW);
eq("two customers", r.length, 2);
eq("most recent first", r[0].email, "POPE.Kiharno@icloud.com");

// daysSince edges
eq("visited today -> 0", customerRoster([{ timestamp: "2026-09-01T09:00:00+01:00", email: "t@t.com" }], NOW)[0].daysSince, 0);
eq("visited late yesterday -> 1", customerRoster([{ timestamp: "2026-08-31T23:50:00+01:00", email: "t@t.com" }], NOW)[0].daysSince, 1);

// CSV
const csv = customersToCsv(customerRoster(kiharno, NOW));
const head = csv.split("\n")[0];
eq("csv header", head.startsWith("Name,Email,Phone,Birthday,Customer Type,Total Visits,Marketing Opt-in"), true);
eq("csv one row per person", csv.split("\n").length, 2);
eq("csv records the conflict", /birthday/.test(csv.split("\n")[1]), true);
eq("csv has no Vendor", /Vendor/.test(head), false);

// Empty input
eq("empty roster", customerRoster([], NOW), []);
eq("empty csv is header only", customersToCsv([]).split("\n").length, 1);

// Missing branch must use the same "Unknown" label as the sidebar/visit table
r = customerRoster([
  { timestamp: "2026-08-10T10:00:00+01:00", email: "u@b.com", firstName: "U", branch: "" },
  { timestamp: "2026-08-11T10:00:00+01:00", email: "u@b.com", firstName: "U", branch: "BnS Perry Barr" },
], NOW);
eq("missing branch labelled Unknown", r[0].storeList, ["BnS Perry Barr","Unknown"]);
eq("store view for Unknown finds them", r[0].storeList.includes("Unknown"), true);

// daysSince must follow Europe/London, not the machine's timezone.
// This sandbox runs Asia/Dhaka (+6), which is exactly the case that used to break it.
eq("late-evening UK visit is not counted as tomorrow",
   customerRoster([{ timestamp: "2026-08-31T22:30:00+01:00", email: "tz@t.com" }], NOW)[0].daysSince, 1);
eq("early-hours UK visit today",
   customerRoster([{ timestamp: "2026-09-01T00:30:00+01:00", email: "tz@t.com" }], NOW)[0].daysSince, 0);
// Across the UK DST boundary (clocks go back 25 Oct 2026) the count stays whole days.
eq("spans DST change",
   customerRoster([{ timestamp: "2026-10-23T12:00:00+01:00", email: "d@t.com" }], new Date("2026-10-27T12:00:00+00:00"))[0].daysSince, 4);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
