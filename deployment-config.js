(function () {
  "use strict";

  // Public, non-secret description of this deployment. The current application
  // remains Ranger-specific; this manifest is the compatibility boundary that
  // a future generic Field Atlas host can consume without forking the core.
  window.FIELD_ATLAS_DEPLOYMENT = Object.freeze({
    schemaVersion: 1,
    id: "ranger-corps-keizaal-public-2",
    kind: "ranger",
    product: Object.freeze({
      name: "The Ranger Corps - Field Atlas",
      shortName: "Ranger Atlas",
      genericName: "Field Atlas",
    }),
    organization: Object.freeze({
      name: "The Ranger Corps",
      gameCommunity: "Keizaal Online",
      server: "Public 2",
    }),
    terminology: Object.freeze({
      officialAtlas: "Guild Atlas",
      fieldCache: "Trailmark",
      fieldCachePlural: "Trailmarks",
      fieldDrop: "Field Drop",
      fieldDropPlural: "Field Drops",
      member: "Ranger",
      memberPlural: "Rangers",
    }),
    officialAtlasCode: "GUILD",
    modules: Object.freeze({
      officialAtlas: true,
      fieldCaches: true,
      cacheVisits: true,
      fieldDrops: true,
      headquartersDelivery: true,
      corpsIntel: true,
      rangerProfiles: true,
      overwatch: true,
    }),
    links: Object.freeze({
      mod: "https://www.nexusmods.com/skyrimspecialedition/mods/187059",
    }),
  });
})();
