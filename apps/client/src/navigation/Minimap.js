export class Minimap {
  constructor({
    graph,
    size = 220,
    metresVisible = 180
  }) {
    this.graph = graph;
    this.size = size;
    this.metresVisible = metresVisible;
    this.heading = 0;

    this.root =
      document.createElement('div');

    this.root.className =
      'cityverse-minimap';

    this.canvas =
      document.createElement('canvas');

    this.canvas.width = 440;
    this.canvas.height = 440;
    this.ctx = this.canvas.getContext('2d');

    if (!this.ctx) {
      throw new Error('Could not create the minimap canvas context.');
    }

    this.label =
      document.createElement('div');

    this.label.className =
      'cityverse-minimap-label';

    this.root.append(
      this.canvas,
      this.label
    );

    document.body.appendChild(
      this.root
    );

    this.resize();
  }

  resize() {
    const mobile =
      window.innerWidth <= 700;

    const displaySize =
      mobile
        ? 150
        : this.size;

    this.root.style.width =
      `${displaySize}px`;

    this.canvas.style.width =
      `${displaySize}px`;

    this.canvas.style.height =
      `${displaySize}px`;
  }

  update({
    x,
    z,
    heading = 0,
    driving = false
  }) {
    this.heading = heading;

    const ctx =
      this.ctx;

    const width =
      this.canvas.width;

    const height =
      this.canvas.height;

    ctx.clearRect(
      0,
      0,
      width,
      height
    );

    ctx.fillStyle =
      'rgba(12,16,20,.88)';

    ctx.fillRect(
      0,
      0,
      width,
      height
    );

    const scale =
      width /
      (
        this.metresVisible *
        2
      );

    const centerX =
      width / 2;

    const centerY =
      height / 2;

    let nearestRoad =
      null;

    let nearestDistance =
      Infinity;

    ctx.lineCap =
      'round';

    for (
      const edge
      of this.graph.edges
    ) {
      const pair =
        this.graph
          .getEdgePosition(
            edge
          );

      if (!pair) {
        continue;
      }

      const { from, to } =
        pair;

      if (
        Math.abs(from.x - x) >
          this.metresVisible * 1.5 &&
        Math.abs(to.x - x) >
          this.metresVisible * 1.5
      ) {
        continue;
      }

      if (
        Math.abs(from.z - z) >
          this.metresVisible * 1.5 &&
        Math.abs(to.z - z) >
          this.metresVisible * 1.5
      ) {
        continue;
      }

      const ax =
        centerX +
        (
          from.x -
          x
        ) *
        scale;

      const ay =
        centerY +
        (
          from.z -
          z
        ) *
        scale;

      const bx =
        centerX +
        (
          to.x -
          x
        ) *
        scale;

      const by =
        centerY +
        (
          to.z -
          z
        ) *
        scale;

      ctx.strokeStyle =
        edge.type === 'primary' ||
        edge.type === 'trunk'
          ? '#d9c8a0'
          : edge.type === 'secondary'
            ? '#bcb8ad'
            : '#777b7e';

      ctx.lineWidth =
        Math.max(
          2,
          Math.min(
            8,
            edge.width *
              scale *
              0.16
          )
        );

      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();

      const mx =
        (from.x + to.x) / 2;
      const mz =
        (from.z + to.z) / 2;
      const distance =
        Math.hypot(
          mx - x,
          mz - z
        );

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestRoad = edge;
      }
    }

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(-heading);
    ctx.fillStyle =
      driving
        ? '#4fb3ff'
        : '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(10, 11);
    ctx.lineTo(0, 6);
    ctx.lineTo(-10, 11);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    this.label.textContent =
      nearestRoad?.name
        ? nearestRoad.name
        : nearestRoad?.type
          ? nearestRoad.type
          : 'Ibadan';

    this.resize();
  }
}
