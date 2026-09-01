import { Canvas } from '@react-three/fiber';
import { Sparkles } from '@react-three/drei';

export default function KokoroWaves() {
  return (
    <div className="kokoro-waves" aria-hidden="true">
      <Canvas
        dpr={[1, 1.4]}
        camera={{ position: [0.35, 0.05, 8], fov: 36 }}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      >
        <Sparkles
          count={64}
          scale={[4.8, 0.95, 0.35]}
          size={1.15}
          speed={0.11}
          color="#edbe6d"
          opacity={0.52}
        />
        <Sparkles
          count={26}
          scale={[3.1, 0.55, 0.22]}
          size={1.85}
          speed={0.07}
          color="#fff1c9"
          opacity={0.32}
        />
      </Canvas>
    </div>
  );
}
