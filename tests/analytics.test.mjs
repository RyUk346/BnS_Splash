import { loyaltyTier, daysUntilBirthday, toCsv } from "../lib/analytics.js";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : (fail++, console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`));
};

// loyaltyTier
eq("0 visits -> first", loyaltyTier(0).label, "First visit");
eq("1 visit -> first", loyaltyTier(1).label, "First visit");
eq("2 -> returning", loyaltyTier(2).label, "Returning");
eq("3 -> regular", loyaltyTier(3).label, "Regular");
eq("4 -> regular", loyaltyTier(4).label, "Regular");
eq("5 -> vip", loyaltyTier(5).label, "VIP");
eq("99 -> vip", loyaltyTier(99).label, "VIP");
eq("undefined safe", loyaltyTier(undefined).label, "First visit");
eq("string ok", loyaltyTier("5").label, "VIP");

// daysUntilBirthday — reference "now" = 1 Sep 2026 (a Tuesday)
const now = new Date(2026, 8, 1, 14, 30);
eq("today", daysUntilBirthday("01/09/1990", now), 0);
eq("tomorrow", daysUntilBirthday("02/09/1990", now), 1);
eq("no year", daysUntilBirthday("05/09", now), 4);
eq("end of month", daysUntilBirthday("30/09/2000", now), 29);
eq("next month", daysUntilBirthday("01/10/2000", now), 30);
eq("already passed -> next year", daysUntilBirthday("31/08/1990", now), 364);
eq("jan wraps", daysUntilBirthday("01/01/1990", now), 122);
eq("blank", daysUntilBirthday("", now), null);
eq("garbage", daysUntilBirthday("not a date", now), null);
eq("bad month", daysUntilBirthday("01/13/1990", now), null);
eq("bad day", daysUntilBirthday("00/09/1990", now), null);
eq("null input", daysUntilBirthday(null, now), null);

// leap year: 29 Feb from 1 Mar 2027 (2028 IS a leap year)
// 29 Feb is honoured on 1 Mar in non-leap years (deliberate).
eq("29 Feb -> 1 Mar in non-leap year", daysUntilBirthday("29/02/1992", new Date(2027, 2, 1)), 0);
eq("29 Feb from 28 Feb non-leap", daysUntilBirthday("29/02/1992", new Date(2027, 1, 28)), 1);
eq("29 Feb rolls to real leap day", daysUntilBirthday("29/02/1992", new Date(2027, 2, 2)), 364);
// impossible dates must not slide into the next month
eq("31 April rejected", daysUntilBirthday("31/04/1990", new Date(2026, 8, 1)), null);
eq("31 June rejected", daysUntilBirthday("31/06/1990", new Date(2026, 8, 1)), null);
eq("30 Feb rejected", daysUntilBirthday("30/02/1990", new Date(2026, 8, 1)), null);
eq("31 Dec valid", daysUntilBirthday("31/12/1990", new Date(2026, 8, 1)), 121);

// DST boundary: UK clocks go back 25 Oct 2026. 26 Oct target from 24 Oct.
eq("across DST", daysUntilBirthday("26/10/1990", new Date(2026, 9, 24, 23, 0)), 2);

// toCsv shape
const csv = toCsv([{ firstName: "Sam", email: "s@x.com", phone: "07700900000",
  birthday: "14/03/1990", visits: 6, promo: "Yes", branch: "Bordesley",
  dateKey: "2026-09-01", timestamp: "2026-09-01T12:00:00Z", totalMinutes: 34,
  sessions: 1, mac: "aa:bb", ssid: "BnS" }]);
const head = csv.split("\n")[0];
eq("csv has no Vendor", /Vendor/.test(head), false);
eq("csv has no Device Name", /Device Name/.test(head), false);
eq("csv starts with Name", head.startsWith("Name,Email,Phone,Birthday,Customer Type,Total Visits"), true);
eq("csv derives tier", csv.split("\n")[1].includes("VIP"), true);
// naive comma-split would break on the quoted date, so parse properly
const parseCsvLine = (line) => { const out=[]; let cur="",q=false;
  for (let i=0;i<line.length;i++){const ch=line[i];
    if(q){ if(ch==='"'){ if(line[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=ch; }
    else if(ch==='"') q=true; else if(ch===","){out.push(cur);cur="";} else cur+=ch; }
  out.push(cur); return out; };
eq("csv column count matches", parseCsvLine(csv.split("\n")[1]).length, head.split(",").length);
eq("csv quotes the date safely", parseCsvLine(csv.split("\n")[1])[8], "2026-09-01");

// tier passed through as object (dashboard path)
const csv2 = toCsv([{ firstName: "A", tier: { label: "Regular" }, visits: 3 }]);
eq("csv uses supplied tier", csv2.split("\n")[1].includes("Regular"), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
