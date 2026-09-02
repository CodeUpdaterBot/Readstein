import { Canvas, useFrame } from '@react-three/fiber';
import { Sparkles } from '@react-three/drei';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

function SparkleField({ scroll }: { scroll: React.MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!group.current) return;
    group.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.08) * 0.025;
    group.current.position.y = Math.sin(state.clock.elapsedTime * 0.22) * 0.035;
    group.current.scale.setScalar(
      THREE.MathUtils.lerp(group.current.scale.x, 1 + scroll.current * 0.08, 0.035),
    );
  });

  return (
    <group ref={group} position={[0.45, 0.1, 0]}>
      <Sparkles
        count={115}
        scale={[4.5, 3.1, 0.85]}
        size={1.35}
        speed={0.17}
        color='#edbe6d'
        opacity={0.7}
      />
      <Sparkles
        count={52}
        scale={[3.2, 1.8, 0.5]}
        size={2.1}
        speed={0.1}
        color='#fff1c9'
        opacity={0.45}
      />
    </group>
  );
}

export default function LibraryFlowScene() {
  const scroll = useRef(0);

  useEffect(() => {
    const update = () => {
      scroll.current = THREE.MathUtils.clamp(window.scrollY / window.innerHeight, 0, 1);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  return (
    <div className='hero-canvas' aria-hidden='true'>
      <Canvas
        dpr={[1, 1.45]}
        camera={{ position: [0, 0.1, 8.2], fov: 39 }}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      >
        <SparkleField scroll={scroll} />
      </Canvas>
    </div>
  );
}
