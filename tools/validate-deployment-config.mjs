import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const files = process.argv.slice(2);
const targets = files.length
  ? files
  : ["deployment-config.js"];

const requiredTerms = [
  "officialAtlas",
  "fieldCache",
  "fieldCachePlural",
  "fieldDrop",
  "fieldDropPlural",
  "member",
  "memberPlural",
];

const requiredModules = [
  "officialAtlas",
  "fieldCaches",
  "cacheVisits",
  "fieldDrops",
  "headquartersDelivery",
  "corpsIntel",
  "rangerProfiles",
  "overwatch",
];

for (const target of targets) {
  const filename = path.resolve(target);
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  validateConfig(context.window.FIELD_ATLAS_DEPLOYMENT, target);
  console.log(`Deployment config valid: ${target}`);
}

function validateConfig(config, source) {
  assert(config && typeof config === "object", source, "must assign window.FIELD_ATLAS_DEPLOYMENT");
  assert(config.schemaVersion === 1, source, "schemaVersion must be 1");
  assertText(config.id, source, "id");
  assertText(config.kind, source, "kind");
  assertText(config.product?.name, source, "product.name");
  assertText(config.product?.shortName, source, "product.shortName");
  assertText(config.product?.genericName, source, "product.genericName");
  assertText(config.organization?.name, source, "organization.name");
  assertText(config.officialAtlasCode, source, "officialAtlasCode");
  assert(
    /^[A-Z0-9_-]{2,24}$/.test(config.officialAtlasCode),
    source,
    "officialAtlasCode must be 2-24 uppercase code characters",
  );

  for (const term of requiredTerms) {
    assertText(config.terminology?.[term], source, `terminology.${term}`);
  }
  for (const moduleName of requiredModules) {
    assert(
      typeof config.modules?.[moduleName] === "boolean",
      source,
      `modules.${moduleName} must be boolean`,
    );
  }

  rejectSecretKeys(config, source);
}

function rejectSecretKeys(value, source, trail = "config") {
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    assert(
      !/(secret|password|passphrase|service.?role|private.?key|anon.?key)/i.test(key),
      source,
      `${trail}.${key} looks secret-bearing and cannot be public deployment metadata`,
    );
    rejectSecretKeys(child, source, `${trail}.${key}`);
  }
}

function assertText(value, source, field) {
  assert(typeof value === "string" && value.trim().length > 0, source, `${field} must be non-empty text`);
}

function assert(condition, source, message) {
  if (!condition) {
    throw new Error(`${source}: ${message}`);
  }
}
