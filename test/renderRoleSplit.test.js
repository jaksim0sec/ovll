import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function read(path){
  return fs.readFileSync(
    new URL(
      "../"+path,
      import.meta.url
    ),
    "utf8"
  );
}

test("Render no longer serves the Vercel frontend",()=>{
  const server=
    read("server.js");

  assert.doesNotMatch(
    server,
    /express\.static\s*\(/
  );
  assert.doesNotMatch(
    server,
    /FRONT_DIR|HOME_FILE/
  );
  assert.doesNotMatch(
    server,
    /\['\/home',\s*'\/home\/'\]/
  );
  assert.doesNotMatch(
    server,
    /\['\/log',\s*'\/log\/'\]/
  );
  assert.doesNotMatch(
    server,
    /res\.redirect\(\s*['"]\/home/
  );
});

test("Render keeps the cron wake endpoint without filesystem work",()=>{
  const server=
    read("server.js");

  assert.match(
    server,
    /app\.get\(\s*['"]\/cron\.txt['"]/
  );
  assert.match(
    server,
    /nothingToSeeHere/
  );
  assert.doesNotMatch(
    server,
    /CRON_FILE/
  );
  assert.doesNotMatch(
    server,
    /sendFile\s*\(/
  );
});

test("Vercel owns UI routes while proxying backend routes to Render",()=>{
  const config=
    JSON.parse(
      read(
        "front/vercel.json"
      )
    );

  assert.ok(
    config.rewrites.some(
      item=>
        item.source===
          "/home" &&
        item.destination===
          "/index.html"
    )
  );

  assert.ok(
    config.rewrites.some(
      item=>
        item.source===
          "/log" &&
        item.destination===
          "/log.html"
    )
  );

  assert.ok(
    config.rewrites.some(
      item=>
        item.source===
          "/cron.txt" &&
        item.destination===
          "https://astra-ep6m.onrender.com/cron.txt"
    )
  );

  assert.ok(
    config.rewrites.some(
      item=>
        item.source===
          "/api/:path*" &&
        item.destination===
          "https://astra-ep6m.onrender.com/api/:path*"
    )
  );
});

test("Render split update bumps the server version",()=>{
  const server=
    read("server.js");

  assert.match(
    server,
    /2026\.10\.06\.112/
  );
});
