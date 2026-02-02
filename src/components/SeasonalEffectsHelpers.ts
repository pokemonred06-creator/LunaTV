export const createCachedCanvas = (
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement => {
  if (typeof document === 'undefined') {
    // Return a dummy canvas for SSR safety
    return null as unknown as HTMLCanvasElement;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) draw(ctx);
  return c;
};

export const generateTextures = () => {
  if (typeof document === 'undefined')
    return { leaves: [], petals: [], snow: [] };

  // -- Leaves (Veins + Shapes) --
  const leafColors = [
    { fill: '#D2691E', stroke: '#8B4513' }, // Chocolate
    { fill: '#DAA520', stroke: '#B8860B' }, // Goldenrod
    { fill: '#CD5C5C', stroke: '#8B0000' }, // IndianRed
    { fill: '#8B4513', stroke: '#5D4037' }, // SaddleBrown
  ];

  const leaves = leafColors.map((c, i) => {
    return createCachedCanvas(40, 40, (ctx) => {
      ctx.translate(20, 20);
      ctx.scale(1.2, 1.2);
      ctx.fillStyle = c.fill;
      ctx.strokeStyle = c.stroke;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';

      const shapeType = i % 3; // 0: Oval (Simple), 1: Maple (Pointed), 2: Oak (Lobed)

      ctx.beginPath();
      if (shapeType === 0) {
        // Simple Oval
        ctx.moveTo(0, -15);
        ctx.bezierCurveTo(10, -10, 10, 10, 0, 15);
        ctx.bezierCurveTo(-10, 10, -10, -10, 0, -15);
      } else if (shapeType === 1) {
        // Maple-ish (Pointed)
        ctx.moveTo(0, -15);
        ctx.lineTo(5, -5);
        ctx.lineTo(12, -8);
        ctx.lineTo(8, 0); // Right Top
        ctx.lineTo(14, 5);
        ctx.lineTo(5, 8);
        ctx.lineTo(0, 15); // Right Bottom
        ctx.lineTo(-5, 8);
        ctx.lineTo(-14, 5);
        ctx.lineTo(-8, 0); // Left Bottom
        ctx.lineTo(-12, -8);
        ctx.lineTo(-5, -5);
        ctx.lineTo(0, -15); // Left Top
      } else {
        // Oak-ish (Lobed)
        ctx.moveTo(0, -15);
        ctx.bezierCurveTo(5, -15, 8, -10, 5, -5);
        ctx.bezierCurveTo(12, -5, 12, 5, 5, 8);
        ctx.bezierCurveTo(5, 12, 2, 15, 0, 15);
        ctx.bezierCurveTo(-2, 15, -5, 12, -5, 8);
        ctx.bezierCurveTo(-12, 5, -12, -5, -5, -5);
        ctx.bezierCurveTo(-8, -10, -5, -15, 0, -15);
      }
      ctx.fill();

      // Common Veins
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(0, 12); // Spine
      // Varied veins based on shape
      if (shapeType === 1) {
        ctx.moveTo(0, 0);
        ctx.lineTo(10, -5);
        ctx.moveTo(0, 0);
        ctx.lineTo(-10, -5);
        ctx.moveTo(0, 5);
        ctx.lineTo(8, 8);
        ctx.moveTo(0, 5);
        ctx.lineTo(-8, 8);
      } else {
        ctx.moveTo(0, -4);
        ctx.lineTo(6, -8);
        ctx.moveTo(0, -4);
        ctx.lineTo(-6, -8);
        ctx.moveTo(0, 4);
        ctx.lineTo(6, 0);
        ctx.moveTo(0, 4);
        ctx.lineTo(-6, 0);
      }
      ctx.stroke();
    }).toDataURL();
  });

  // -- Petals (Shapes + Grain) --
  const petalColors = [
    { main: '#FFC0CB', accent: '#FF69B4' }, // Pink
    { main: '#FFB7C5', accent: '#FF1493' }, // Cherry Blossom
    { main: '#FFE4E1', accent: '#DB7093' }, // Misty Rose
    { main: '#F8F8FF', accent: '#D8BFD8' }, // GhostWhite/Thistle
  ];

  const petals = petalColors.map((c, i) => {
    return createCachedCanvas(30, 30, (ctx) => {
      ctx.translate(15, 15);

      // Gradient
      const grad = ctx.createLinearGradient(0, -15, 0, 15);
      grad.addColorStop(0, c.main);
      grad.addColorStop(1, c.accent);
      ctx.fillStyle = grad;

      const shapeType = i % 3; // 0: Oval, 1: Heart (Sakura), 2: Teardrop

      ctx.beginPath();
      if (shapeType === 1) {
        // Sakura (Heart notch)
        ctx.moveTo(0, -12);
        ctx.bezierCurveTo(5, -15, 10, -10, 8, 0);
        ctx.bezierCurveTo(5, 10, 0, 14, 0, 14);
        ctx.bezierCurveTo(0, 14, -5, 10, -8, 0);
        ctx.bezierCurveTo(-10, -10, -5, -15, 0, -12);
      } else if (shapeType === 2) {
        // Teardrop
        ctx.moveTo(0, -14);
        ctx.bezierCurveTo(8, -5, 8, 8, 0, 12);
        ctx.bezierCurveTo(-8, 8, -8, -5, 0, -14);
      } else {
        // Standard Oval
        ctx.ellipse(0, 0, 8, 12, 0, 0, Math.PI * 2);
      }
      ctx.fill();

      // Grain
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      for (let j = 0; j < 8; j++) {
        ctx.beginPath();
        ctx.arc(
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 20,
          0.6,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }).toDataURL();
  });

  // -- Snow (Soft Gradient) --
  const snow = [
    createCachedCanvas(20, 20, (ctx) => {
      const grad = ctx.createRadialGradient(10, 10, 0, 10, 10, 10);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.8, 'rgba(255,255,255,0.8)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 20, 20);
    }).toDataURL(),
  ];

  return { leaves, petals, snow };
};
