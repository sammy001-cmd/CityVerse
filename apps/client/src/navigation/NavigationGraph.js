export class NavigationGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = [];
    this.adjacency = new Map();
  }

  async load(
    url = '/data/road-tiles/navigation-graph.json'
  ) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Navigation graph failed (${response.status})`
      );
    }

    const data = await response.json();

    this.nodes.clear();
    this.edges.length = 0;
    this.adjacency.clear();

    for (
      const [id, node]
      of Object.entries(data.nodes ?? {})
    ) {
      const record = {
        id,
        x: node.x,
        z: node.z
      };

      this.nodes.set(
        id,
        record
      );

      this.adjacency.set(
        id,
        []
      );
    }

    for (
      const edge
      of data.edges ?? []
    ) {
      if (
        !this.nodes.has(edge.from) ||
        !this.nodes.has(edge.to)
      ) {
        continue;
      }

      this.edges.push(edge);

      this.addConnection(
        edge.from,
        edge.to,
        edge
      );

      if (!edge.oneWay) {
        this.addConnection(
          edge.to,
          edge.from,
          {
            ...edge,
            from: edge.to,
            to: edge.from
          }
        );
      }
    }

    console.log(
      `Navigation graph ready: ` +
      `${this.nodes.size} nodes, ` +
      `${this.edges.length} physical edges`
    );

    return this;
  }

  addConnection(from, to, edge) {
    if (!this.adjacency.has(from)) {
      this.adjacency.set(
        from,
        []
      );
    }

    this.adjacency
      .get(from)
      .push({
        to,
        edge
      });
  }

  connections(nodeId) {
    return (
      this.adjacency.get(nodeId) ??
      []
    );
  }

  nearestNode(
    x,
    z,
    maxDistance = Infinity
  ) {
    let result = null;
    let bestDistance = maxDistance;

    for (
      const node
      of this.nodes.values()
    ) {
      const distance =
        Math.hypot(
          node.x - x,
          node.z - z
        );

      if (
        distance <
        bestDistance
      ) {
        bestDistance =
          distance;

        result = {
          ...node,
          distance
        };
      }
    }

    return result;
  }

  getEdgePosition(edge) {
    const from =
      this.nodes.get(
        edge.from
      );

    const to =
      this.nodes.get(
        edge.to
      );

    if (!from || !to) {
      return null;
    }

    return {
      from,
      to
    };
  }
}
