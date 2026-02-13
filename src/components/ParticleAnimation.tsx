import React, { useEffect, useRef } from 'react';

interface ParticleAnimationProps {
  quantity?: number;
  staticity?: number;
  ease?: number;
  className?: string;
}

interface Circle {
  x: number;
  y: number;
  translateX: number;
  translateY: number;
  size: number;
  alpha: number;
  targetAlpha: number;
  dx: number;
  dy: number;
  magnetism: number;
}

const ParticleAnimation: React.FC<ParticleAnimationProps> = ({
  quantity = 30,
  staticity = 50,
  ease = 50,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const circlesRef = useRef<Circle[]>([]);
  const mouseRef = useRef({ x: 0, y: 0 });
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  const dprRef = useRef(1);
  const animationFrameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    dprRef.current = window.devicePixelRatio || 1;

    const circleParams = (): Circle => {
      const x = Math.floor(Math.random() * canvasSizeRef.current.w);
      const y = Math.floor(Math.random() * canvasSizeRef.current.h);
      const size = Math.floor(Math.random() * 2) + 1;
      const alpha = 0;
      const targetAlpha = parseFloat((Math.random() * 0.6 + 0.1).toFixed(1));
      const dx = (Math.random() - 0.5) * 0.2;
      const dy = (Math.random() - 0.5) * 0.2;
      const magnetism = 0.1 + Math.random() * 4;
      return { x, y, translateX: 0, translateY: 0, size, alpha, targetAlpha, dx, dy, magnetism };
    };

    const drawCircle = (circle: Circle, update = false) => {
      const { x, y, translateX, translateY, size, alpha } = circle;
      context.translate(translateX, translateY);
      context.beginPath();
      context.arc(x, y, size, 0, 2 * Math.PI);
      context.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      context.fill();
      context.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
      if (!update) {
        circlesRef.current.push(circle);
      }
    };

    const clearContext = () => {
      context.clearRect(0, 0, canvasSizeRef.current.w, canvasSizeRef.current.h);
    };

    const resizeCanvas = () => {
      circlesRef.current = [];
      canvasSizeRef.current.w = container.offsetWidth;
      canvasSizeRef.current.h = container.offsetHeight;
      canvas.width = canvasSizeRef.current.w * dprRef.current;
      canvas.height = canvasSizeRef.current.h * dprRef.current;
      canvas.style.width = canvasSizeRef.current.w + 'px';
      canvas.style.height = canvasSizeRef.current.h + 'px';
      context.scale(dprRef.current, dprRef.current);
    };

    const drawParticles = () => {
      clearContext();
      for (let i = 0; i < quantity; i++) {
        const circle = circleParams();
        drawCircle(circle);
      }
    };

    const remapValue = (value: number, start1: number, end1: number, start2: number, end2: number) => {
      const remapped = (value - start1) * (end2 - start2) / (end1 - start1) + start2;
      return remapped > 0 ? remapped : 0;
    };

    const animate = () => {
      clearContext();
      circlesRef.current.forEach((circle, i) => {
        const edge = [
          circle.x + circle.translateX - circle.size,
          canvasSizeRef.current.w - circle.x - circle.translateX - circle.size,
          circle.y + circle.translateY - circle.size,
          canvasSizeRef.current.h - circle.y - circle.translateY - circle.size,
        ];
        const closestEdge = edge.reduce((a, b) => Math.min(a, b));
        const remapClosestEdge = parseFloat(remapValue(closestEdge, 0, 20, 0, 1).toFixed(2));
        
        if (remapClosestEdge > 1) {
          circle.alpha += 0.02;
          if (circle.alpha > circle.targetAlpha) circle.alpha = circle.targetAlpha;
        } else {
          circle.alpha = circle.targetAlpha * remapClosestEdge;
        }
        
        circle.x += circle.dx;
        circle.y += circle.dy;
        circle.translateX += ((mouseRef.current.x / (staticity / circle.magnetism)) - circle.translateX) / ease;
        circle.translateY += ((mouseRef.current.y / (staticity / circle.magnetism)) - circle.translateY) / ease;

        if (
          circle.x < -circle.size ||
          circle.x > canvasSizeRef.current.w + circle.size ||
          circle.y < -circle.size ||
          circle.y > canvasSizeRef.current.h + circle.size
        ) {
          circlesRef.current.splice(i, 1);
          const newCircle = circleParams();
          drawCircle(newCircle);
        } else {
          drawCircle(
            { ...circle, x: circle.x, y: circle.y, translateX: circle.translateX, translateY: circle.translateY, alpha: circle.alpha },
            true
          );
        }
      });
      animationFrameRef.current = window.requestAnimationFrame(animate);
    };

    const handleMouseMove = (event: MouseEvent | TouchEvent) => {
      let clientX: number, clientY: number;
      
      if ('touches' in event) {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
      } else {
        clientX = event.clientX;
        clientY = event.clientY;
      }
      
      const rect = canvas.getBoundingClientRect();
      const { w, h } = canvasSizeRef.current;
      const x = clientX - rect.left - w / 2;
      const y = clientY - rect.top - h / 2;
      const inside = x < w / 2 && x > -w / 2 && y < h / 2 && y > -h / 2;
      
      if (inside) {
        mouseRef.current.x = x;
        mouseRef.current.y = y;
      }
    };

    const init = () => {
      resizeCanvas();
      drawParticles();
      animate();
    };

    init();

    window.addEventListener('resize', () => {
      resizeCanvas();
      drawParticles();
    });
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleMouseMove);

    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleMouseMove);
    };
  }, [quantity, staticity, ease]);

  return (
    <div ref={containerRef} className={`absolute inset-0 ${className}`}>
      <canvas ref={canvasRef} />
    </div>
  );
};

export default ParticleAnimation;
