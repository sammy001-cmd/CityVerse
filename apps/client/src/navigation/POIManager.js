export class POIManager {
  constructor({
    baseUrl = '/data/poi-tiles'
  } = {}) {
    this.baseUrl = baseUrl;

    this.manifest = null;

    this.tiles = new Map();

    this.pois = new Map();

    this.categories = new Map();
  }


  async init() {
    const response =
      await fetch(
        `${this.baseUrl}/manifest.json`
      );

    if (!response.ok) {
      throw new Error(
        `POI manifest failed (${response.status})`
      );
    }

    this.manifest =
      await response.json();

    return this;
  }


  async loadAll() {
    if (!this.manifest) {
      await this.init();
    }

    const requests =
      this.manifest.tiles.map(
        (key) =>
          this.loadTile(key)
      );

    await Promise.all(
      requests
    );

    return this;
  }


  async loadTile(key) {
    if (this.tiles.has(key)) {
      return this.tiles.get(key);
    }

    const response =
      await fetch(
        `${this.baseUrl}/${key}.json`
      );

    if (!response.ok) {
      throw new Error(
        `POI tile ${key} failed (${response.status})`
      );
    }

    const tile =
      await response.json();

    this.tiles.set(
      key,
      tile
    );

    for (
      const poi
      of tile.pois ?? []
    ) {
      this.pois.set(
        poi.id,
        poi
      );

      if (
        !this.categories.has(
          poi.category
        )
      ) {
        this.categories.set(
          poi.category,
          []
        );
      }

      this.categories
        .get(poi.category)
        .push(poi);
    }

    return tile;
  }


  all() {
    return [
      ...this.pois.values()
    ];
  }


  get(id) {
    return (
      this.pois.get(id) ??
      null
    );
  }


  byCategory(category) {
    return (
      this.categories.get(
        category
      ) ??
      []
    );
  }


  search(
    query,
    {
      category = null,
      limit = 40
    } = {}
  ) {
    const text =
      String(query ?? '')
        .trim()
        .toLowerCase();

    const source =
      category
        ? this.byCategory(category)
        : this.all();

    if (!text) {
      return source.slice(
        0,
        limit
      );
    }

    const scored = [];

    for (
      const poi
      of source
    ) {
      const name =
        poi.name
          ?.toLowerCase() ??
        '';

      const address =
        poi.address
          ?.toLowerCase() ??
        '';

      const categoryName =
        poi.category
          ?.toLowerCase() ??
        '';

      let score = 0;

      if (name === text) {
        score += 100;
      } else if (
        name.startsWith(text)
      ) {
        score += 70;
      } else if (
        name.includes(text)
      ) {
        score += 50;
      }

      if (
        address.includes(text)
      ) {
        score += 20;
      }

      if (
        categoryName.includes(text)
      ) {
        score += 10;
      }

      if (score > 0) {
        scored.push({
          poi,
          score
        });
      }
    }

    scored.sort(
      (a, b) =>
        b.score -
        a.score
    );

    return scored
      .slice(
        0,
        limit
      )
      .map(
        (entry) =>
          entry.poi
      );
  }


  nearest(
    x,
    z,
    {
      category = null,
      maxDistance = Infinity,
      limit = 10
    } = {}
  ) {
    const source =
      category
        ? this.byCategory(category)
        : this.all();

    const results = [];

    for (
      const poi
      of source
    ) {
      const distance =
        Math.hypot(
          poi.x - x,
          poi.z - z
        );

      if (
        distance >
        maxDistance
      ) {
        continue;
      }

      results.push({
        poi,
        distance
      });
    }

    results.sort(
      (a, b) =>
        a.distance -
        b.distance
    );

    return results.slice(
      0,
      limit
    );
  }


  categoryCounts() {
    const result = {};

    for (
      const [
        category,
        pois
      ]
      of this.categories
    ) {
      result[category] =
        pois.length;
    }

    return result;
  }
}