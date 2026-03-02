import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw } from 'lucide-react';

// --- Types & Constants ---

type GameState = 'MENU' | 'MAP_SELECT' | 'PLAYING' | 'GAME_OVER';

type MapType = 'DESERT' | 'CITY' | 'WASTELAND';

interface Tank {
  x: number;
  y: number;
  angle: number;
  turretAngle: number;
  health: number;
  maxHealth: number;
  color: string;
  isPlayer: boolean;
  lastShot: number;
  reloadTime: number;
  speed: number;
  lastDamageTime: number;
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: 'player' | 'enemy';
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

const TANK_SIZE = 40;
const ENEMY_HITBOX_SIZE = 55; // Increased hitbox
const BULLET_SPEED = 7;
const PLAYER_RELOAD = 300; // ms
const ENEMY_RELOAD = 1500; // ms
const ATTACK_RANGE = 500;
const ENEMY_SPAWN_RATE = 2000; // ms
const WORLD_SIZE = 3000;

// --- Audio Service ---
const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

const playClick = () => {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(800, audioCtx.currentTime);
  gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.1);
};

const playLaser = () => {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(800, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.2);
  gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.2);
};

class EngineSound {
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;

  start() {
    if (this.osc) return;
    this.osc = audioCtx.createOscillator();
    this.gain = audioCtx.createGain();
    this.filter = audioCtx.createBiquadFilter();
    
    this.osc.type = 'sawtooth';
    this.osc.frequency.setValueAtTime(40, audioCtx.currentTime);
    
    this.filter.type = 'lowpass';
    this.filter.frequency.setValueAtTime(150, audioCtx.currentTime);
    
    this.gain.gain.setValueAtTime(0, audioCtx.currentTime);
    
    this.osc.connect(this.filter);
    this.filter.connect(this.gain);
    this.gain.connect(audioCtx.destination);
    
    this.osc.start();
  }

  setVolume(vol: number) {
    if (this.gain) {
      this.gain.gain.setTargetAtTime(vol * 0.05, audioCtx.currentTime, 0.1);
    }
  }

  stop() {
    if (this.osc) {
      this.osc.stop();
      this.osc = null;
    }
  }
}

const playerEngine = new EngineSound();
const enemyEngine = new EngineSound();

// --- Components ---

const Joystick = ({ onMove }: { onMove: (dir: { x: number; y: number }) => void }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const touchIdRef = useRef<number | null>(null);

  const handleStart = (e: React.TouchEvent | React.MouseEvent) => {
    if ('touches' in e) {
      const touch = e.changedTouches[0];
      touchIdRef.current = touch.identifier;
    }
    setIsDragging(true);
  };

  const handleMove = (e: any) => {
    if (!isDragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    let clientX, clientY;
    if (e.touches) {
      let touch = null;
      if (touchIdRef.current !== null) {
        for (let i = 0; i < e.touches.length; i++) {
          if (e.touches[i].identifier === touchIdRef.current) {
            touch = e.touches[i];
            break;
          }
        }
      }
      if (!touch) return;
      clientX = touch.clientX;
      clientY = touch.clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = rect.width / 2;

    if (dist > maxDist) {
      dx = (dx / dist) * maxDist;
      dy = (dy / dist) * maxDist;
    }

    setPos({ x: dx, y: dy });
    onMove({ x: dx / maxDist, y: dy / maxDist });
  };

  const handleEnd = (e: any) => {
    if (e.touches && touchIdRef.current !== null) {
      let touchStillActive = false;
      for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === touchIdRef.current) {
          touchStillActive = true;
          break;
        }
      }
      if (touchStillActive) return;
    }
    
    setIsDragging(false);
    touchIdRef.current = null;
    setPos({ x: 0, y: 0 });
    onMove({ x: 0, y: 0 });
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleEnd);
      window.addEventListener('touchmove', handleMove);
      window.addEventListener('touchend', handleEnd);
    }
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging]);

  return (
    <div 
      ref={containerRef}
      className="w-32 h-32 bg-white/10 rounded-full border-2 border-white/20 relative flex items-center justify-center touch-none"
      onMouseDown={handleStart}
      onTouchStart={handleStart}
    >
      <motion.div 
        className="w-12 h-12 bg-white rounded-full shadow-lg"
        animate={{ x: pos.x, y: pos.y }}
        transition={{ type: 'spring', damping: 15, stiffness: 200 }}
      />
    </div>
  );
};

const Game = ({ selectedMap, onGameOver, setScore, score }: { 
  selectedMap: MapType, 
  onGameOver: () => void,
  setScore: React.Dispatch<React.SetStateAction<number>>,
  score: number
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  
  const playerRef = useRef<Tank>({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    angle: 0,
    turretAngle: 0,
    health: 100,
    maxHealth: 100,
    color: '#ff0000',
    isPlayer: true,
    lastShot: 0,
    reloadTime: PLAYER_RELOAD,
    speed: 4,
    lastDamageTime: 0
  });
  const enemiesRef = useRef<Tank[]>([]);
  const bulletsRef = useRef<Bullet[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const keysRef = useRef<Record<string, boolean>>({});
  const joystickDir = useRef({ x: 0, y: 0 });
  const lastEnemySpawn = useRef(0);
  const cameraRef = useRef({ x: 0, y: 0 });
  const mousePosRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const shoot = (tank: Tank) => {
    const now = Date.now();
    if (now - tank.lastShot < tank.reloadTime) return;
    
    const vx = Math.cos(tank.turretAngle) * BULLET_SPEED;
    const vy = Math.sin(tank.turretAngle) * BULLET_SPEED;
    
    bulletsRef.current.push({
      x: tank.x + Math.cos(tank.turretAngle) * 30,
      y: tank.y + Math.sin(tank.turretAngle) * 30,
      vx, vy,
      owner: tank.isPlayer ? 'player' : 'enemy'
    });
    
    tank.lastShot = now;
    if (tank.isPlayer) playLaser();
  };

  const createExplosion = (x: number, y: number, color: string) => {
    for (let i = 0; i < 15; i++) {
      particlesRef.current.push({
        x, y,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 10,
        life: 1,
        color
      });
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const handleKeyDown = (e: KeyboardEvent) => keysRef.current[e.key.toLowerCase()] = true;
    const handleKeyUp = (e: KeyboardEvent) => keysRef.current[e.key.toLowerCase()] = false;
    
    const handleMouseDown = (e: MouseEvent) => {
      if (isMobile) return;
      if (e.button === 2) {
        shoot(playerRef.current);
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isMobile) return;
      const rect = canvas.getBoundingClientRect();
      mousePosRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('contextmenu', handleContextMenu);

    playerEngine.start();
    enemyEngine.start();

    let animationFrame: number;

    const update = () => {
      const player = playerRef.current;
      
      // Update turret angle based on mouse position
      if (!isMobile) {
        const screenX = canvas.width / 2;
        const screenY = canvas.height / 2;
        player.turretAngle = Math.atan2(mousePosRef.current.y - screenY, mousePosRef.current.x - screenX);
      }

      let playerMoving = false;
      if (isMobile) {
        const dx = joystickDir.current.x;
        const dy = joystickDir.current.y;
        if (dx !== 0 || dy !== 0) {
          const mag = Math.sqrt(dx * dx + dy * dy);
          player.x += (dx / mag) * player.speed;
          player.y += (dy / mag) * player.speed;
          player.angle = Math.atan2(dy, dx);
          player.turretAngle = player.angle;
          playerMoving = true;
        }
      } else {
        // PC Movement & Rotation
        // Only move forward with 'w'
        if (keysRef.current['w']) {
          // Body rotates with turret (mouse) only when moving forward
          player.angle = player.turretAngle;
          
          player.x += Math.cos(player.angle) * player.speed;
          player.y += Math.sin(player.angle) * player.speed;
          playerMoving = true;
        }
      }
      playerEngine.setVolume(playerMoving ? 1 : 0.2);

      cameraRef.current.x = player.x - canvas.width / 2;
      cameraRef.current.y = player.y - canvas.height / 2;
      
      const camX = cameraRef.current.x;
      const camY = cameraRef.current.y;

      if (Date.now() - lastEnemySpawn.current > ENEMY_SPAWN_RATE) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.max(canvas.width, canvas.height) * 0.8;
        enemiesRef.current.push({
          x: player.x + Math.cos(angle) * dist,
          y: player.y + Math.sin(angle) * dist,
          angle: 0, turretAngle: 0, health: 50, maxHealth: 50, color: '#00ff00', isPlayer: false, lastShot: 0, reloadTime: ENEMY_RELOAD, speed: 2, lastDamageTime: 0
        });
        lastEnemySpawn.current = Date.now();
      }

      let enemiesMoving = false;
      enemiesRef.current.forEach(enemy => {
        const distToPlayer = Math.sqrt((player.x - enemy.x)**2 + (player.y - enemy.y)**2);
        
        if (distToPlayer > ATTACK_RANGE * 0.7) {
          const angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
          enemy.x += Math.cos(angle) * enemy.speed;
          enemy.y += Math.sin(angle) * enemy.speed;
          enemy.angle = angle;
          enemiesMoving = true;
        }

        enemy.turretAngle = Math.atan2(player.y - enemy.y, player.x - enemy.x);

        if (distToPlayer < ATTACK_RANGE) {
          shoot(enemy);
        }
      });
      enemyEngine.setVolume(enemiesMoving ? 0.8 : 0);

      bulletsRef.current = bulletsRef.current.filter(b => {
        b.x += b.vx;
        b.y += b.vy;

        if (b.x < camX - 100 || b.x > camX + canvas.width + 100 || b.y < camY - 100 || b.y > camY + canvas.height + 100) return false;

        if (b.owner === 'player') {
          for (let i = 0; i < enemiesRef.current.length; i++) {
            const e = enemiesRef.current[i];
            const dist = Math.sqrt((b.x - e.x)**2 + (b.y - e.y)**2);
            if (dist < ENEMY_HITBOX_SIZE / 2) {
              e.health -= 25;
              createExplosion(b.x, b.y, '#ffff00');
              if (e.health <= 0) {
                enemiesRef.current.splice(i, 1);
                setScore(s => s + 100);
                createExplosion(e.x, e.y, '#00ff00');
              }
              return false;
            }
          }
        } else {
          const dist = Math.sqrt((b.x - player.x)**2 + (b.y - player.y)**2);
          if (dist < TANK_SIZE / 2) {
            player.health -= 10;
            player.lastDamageTime = Date.now();
            createExplosion(b.x, b.y, '#ffff00');
            if (player.health <= 0) {
              onGameOver();
            }
            return false;
          }
        }

        return true;
      });

      // Health Regeneration
      const now = Date.now();
      if (now - player.lastDamageTime > 800) {
        if (player.health < player.maxHealth) {
          player.health = Math.min(player.maxHealth, player.health + 0.1);
        }
      }

      particlesRef.current = particlesRef.current.filter(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.02;
        return p.life > 0;
      });
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const camX = cameraRef.current.x;
      const camY = cameraRef.current.y;

      ctx.save();
      ctx.translate(-camX, -camY);

      if (selectedMap === 'DESERT') {
        ctx.fillStyle = '#edc9af';
        ctx.fillRect(camX, camY, canvas.width, canvas.height);
        ctx.fillStyle = '#d2b48c';
        for(let i=0; i<200; i++) {
          const x = (i * 791) % WORLD_SIZE;
          const y = (i * 347) % WORLD_SIZE;
          ctx.fillRect(x, y, 4, 4);
        }
      } else if (selectedMap === 'CITY') {
        ctx.fillStyle = '#4a4a4a';
        ctx.fillRect(camX, camY, canvas.width, canvas.height);
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        for(let i=0; i<WORLD_SIZE; i+=200) {
          ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, WORLD_SIZE); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(WORLD_SIZE, i); ctx.stroke();
        }
      } else {
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(camX, camY, canvas.width, canvas.height);
        ctx.strokeStyle = 'rgba(100, 100, 255, 0.3)';
        ctx.lineWidth = 1;
        const time = Date.now() * 0.001;
        for(let i=0; i<200; i++) {
          const x = (i * 123 + time * 200) % WORLD_SIZE;
          const y = (i * 456 + time * 500) % WORLD_SIZE;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 5, y + 15); ctx.stroke();
        }
      }

      const drawTank = (tank: Tank) => {
        ctx.save();
        ctx.translate(tank.x, tank.y);
        
        const now = Date.now();
        if (now - tank.lastShot < tank.reloadTime) {
          const progress = (now - tank.lastShot) / tank.reloadTime;
          ctx.beginPath();
          ctx.arc(0, 0, TANK_SIZE * 0.8, -Math.PI/2, -Math.PI/2 + (Math.PI * 2 * progress));
          ctx.strokeStyle = '#00ff00';
          ctx.lineWidth = 3;
          ctx.stroke();
        }

        ctx.rotate(tank.angle);
        ctx.fillStyle = tank.color;
        ctx.fillRect(-TANK_SIZE/2, -TANK_SIZE/2, TANK_SIZE, TANK_SIZE);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeRect(-TANK_SIZE/2, -TANK_SIZE/2, TANK_SIZE, TANK_SIZE);
        
        ctx.fillStyle = '#333';
        ctx.fillRect(-TANK_SIZE/2 - 5, -TANK_SIZE/2, 10, TANK_SIZE);
        ctx.fillRect(TANK_SIZE/2 - 5, -TANK_SIZE/2, 10, TANK_SIZE);

        ctx.rotate(-tank.angle);
        ctx.rotate(tank.turretAngle);
        ctx.fillStyle = tank.color;
        
        if (!tank.isPlayer) {
          ctx.fillStyle = '#2d5a27';
        }

        ctx.beginPath();
        ctx.arc(0, 0, TANK_SIZE/3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        ctx.fillRect(0, -5, TANK_SIZE * 0.8, 10);
        ctx.strokeRect(0, -5, TANK_SIZE * 0.8, 10);
        
        ctx.restore();

        ctx.fillStyle = '#333';
        ctx.fillRect(tank.x - 20, tank.y - 35, 40, 5);
        ctx.fillStyle = tank.health > 30 ? '#00ff00' : '#ff0000';
        ctx.fillRect(tank.x - 20, tank.y - 35, (tank.health / tank.maxHealth) * 40, 5);
      };

      drawTank(playerRef.current);
      enemiesRef.current.forEach(drawTank);

      bulletsRef.current.forEach(b => {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#fff';
      });
      ctx.shadowBlur = 0;

      particlesRef.current.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 3, 3);
      });
      ctx.globalAlpha = 1;

      ctx.restore();
    };

    const loop = () => {
      update();
      draw();
      animationFrame = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      cancelAnimationFrame(animationFrame);
      playerEngine.stop();
      enemyEngine.stop();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [selectedMap, isMobile, onGameOver, setScore]);

  const camX = cameraRef.current.x;
  const camY = cameraRef.current.y;

  return (
    <div className="absolute inset-0">
      <canvas 
        ref={canvasRef}
        width={window.innerWidth}
        height={window.innerHeight}
        className="block w-full h-full"
      />
      
      <div className="absolute top-8 left-8 flex items-center gap-8">
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-widest opacity-50 mb-1">Score</span>
          <span className="text-4xl font-mono">{score.toString().padStart(6, '0')}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-widest opacity-50 mb-1">Armor</span>
          <div className="w-48 h-2 bg-white/10 rounded-full overflow-hidden">
            <motion.div 
              className="h-full bg-red-500"
              animate={{ width: `${playerRef.current.health}%` }}
            />
          </div>
        </div>
      </div>

      {isMobile && (
        <>
          <div className="absolute bottom-12 left-12">
            <Joystick onMove={(dir) => joystickDir.current = dir} />
          </div>
          
          <div className="absolute bottom-12 right-12 flex flex-col gap-4 items-end">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onTouchStart={(e) => {
                e.preventDefault();
                shoot(playerRef.current);
              }}
              onClick={() => {
                if (!isMobile) shoot(playerRef.current);
              }}
              className="w-24 h-24 bg-white rounded-full flex items-center justify-center shadow-2xl"
            >
              <span className="text-black font-light text-xl uppercase tracking-tighter">Shoot</span>
            </motion.button>
            
            <motion.button
              whileTap={{ scale: 0.9 }}
              onTouchStart={(e) => {
                e.preventDefault();
                // Reload logic if any, currently just a placeholder icon
                // If there's no reload logic, we can just play the click sound
                playClick();
              }}
              className="w-16 h-16 bg-zinc-800/80 rounded-full flex items-center justify-center border border-white/20"
            >
              <RefreshCw className="w-6 h-6 text-white" />
            </motion.button>
          </div>
        </>
      )}

      {!isMobile && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-xs uppercase tracking-[0.3em] opacity-30">
          Hold W to Move & Steer with Mouse • Right Click to Fire
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [gameState, setGameState] = useState<GameState>('MENU');
  const [selectedMap, setSelectedMap] = useState<MapType>('DESERT');
  const [score, setScore] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [currentMapIndex, setCurrentMapIndex] = useState(0);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const MAPS = [
    { id: 'DESERT', name: 'Daytime Desert', desc: 'Endless sand dunes under a scorching sun.', color: 'bg-amber-200' },
    { id: 'CITY', name: 'Destroyed City', desc: 'Concrete ruins and narrow alleys.', color: 'bg-zinc-600' },
    { id: 'WASTELAND', name: 'Rainy Wasteland', desc: 'Night falls on a storm-lashed void.', color: 'bg-indigo-950' }
  ];

  const handleMapSelect = (map: MapType) => {
    setSelectedMap(map);
    setGameState('PLAYING');
  };

  return (
    <div className="fixed inset-0 bg-black text-white font-sans overflow-hidden select-none">
      <AnimatePresence mode="wait">
        {gameState === 'MENU' && (
          <motion.div 
            key="menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center bg-black"
          >
            <div className="absolute inset-0 opacity-40 pointer-events-none overflow-hidden flex items-center justify-center">
               <svg width="600" height="600" viewBox="0 0 200 200" className="scale-150">
                  <rect x="60" y="80" width="80" height="60" fill="#ff0000" stroke="black" strokeWidth="2" />
                  <rect x="50" y="80" width="10" height="60" fill="#333" />
                  <rect x="140" y="80" width="10" height="60" fill="#333" />
                  <circle cx="100" cy="110" r="25" fill="#ff0000" stroke="black" strokeWidth="2" />
                  <rect x="100" y="105" width="50" height="10" fill="#ff0000" stroke="black" strokeWidth="2" />
               </svg>
            </div>

            <h1 className="text-8xl font-black tracking-tighter mb-12 z-10 drop-shadow-2xl">
              TANK TANK TANK
            </h1>
            
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                playClick();
                setGameState('MAP_SELECT');
              }}
              className="px-16 py-4 bg-white text-black font-light text-2xl uppercase tracking-widest z-10"
            >
              Start
            </motion.button>
          </motion.div>
        )}

        {gameState === 'MAP_SELECT' && (
          <motion.div 
            key="map-select"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 p-8"
          >
            <h2 className="text-4xl font-bold mb-12 italic">Choose Your Battlefield</h2>
            
            {isMobile ? (
              <div className="relative flex items-center justify-center w-full max-w-sm px-12">
                <button 
                  onClick={() => {
                    playClick();
                    setCurrentMapIndex((prev) => (prev - 1 + MAPS.length) % MAPS.length);
                  }}
                  className="absolute left-0 z-20 w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-lg"
                >
                  <span className="text-black font-light text-xl">{`<`}</span>
                </button>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={MAPS[currentMapIndex].id}
                    initial={{ opacity: 0, x: 50 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -50 }}
                    onClick={() => {
                      playClick();
                      handleMapSelect(MAPS[currentMapIndex].id as MapType);
                    }}
                    className="cursor-pointer bg-zinc-800 rounded-2xl overflow-hidden border border-white/10 w-full"
                  >
                    <div className={`h-48 ${MAPS[currentMapIndex].color}`} />
                    <div className="p-6">
                      <h3 className="text-xl font-bold mb-2">{MAPS[currentMapIndex].name}</h3>
                      <p className="text-zinc-400 text-sm">{MAPS[currentMapIndex].desc}</p>
                    </div>
                  </motion.div>
                </AnimatePresence>

                <button 
                  onClick={() => {
                    playClick();
                    setCurrentMapIndex((prev) => (prev + 1) % MAPS.length);
                  }}
                  className="absolute right-0 z-20 w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-lg"
                >
                  <span className="text-black font-light text-xl">{`>`}</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-5xl">
                {MAPS.map((map) => (
                  <motion.div
                    key={map.id}
                    whileHover={{ scale: 1.02, y: -5 }}
                    onClick={() => {
                      playClick();
                      handleMapSelect(map.id as MapType);
                    }}
                    className="cursor-pointer bg-zinc-800 rounded-2xl overflow-hidden border border-white/10 group"
                  >
                    <div className={`h-48 ${map.color} transition-opacity group-hover:opacity-80`} />
                    <div className="p-6">
                      <h3 className="text-xl font-bold mb-2">{map.name}</h3>
                      <p className="text-zinc-400 text-sm">{map.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {gameState === 'PLAYING' && (
          <motion.div 
            key="playing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0"
          >
            <Game 
              selectedMap={selectedMap} 
              onGameOver={() => setGameState('GAME_OVER')} 
              setScore={setScore}
              score={score}
            />
          </motion.div>
        )}

        {gameState === 'GAME_OVER' && (
          <motion.div 
            key="game-over"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/90 backdrop-blur-sm z-50"
          >
            <h2 className="text-9xl font-black mb-4 tracking-tighter">DESTROYED</h2>
            <p className="text-2xl font-mono mb-12 opacity-70">Final Score: {score}</p>
            <div className="flex gap-4">
              <button 
                onClick={() => {
                  playClick();
                  setScore(0);
                  setGameState('PLAYING');
                }}
                className="px-12 py-4 bg-white text-black font-bold uppercase tracking-widest hover:bg-zinc-200 transition-colors"
              >
                Retry
              </button>
              <button 
                onClick={() => {
                  playClick();
                  setGameState('MENU');
                }}
                className="px-12 py-4 border border-white text-white font-bold uppercase tracking-widest hover:bg-white/10 transition-colors"
              >
                Menu
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
