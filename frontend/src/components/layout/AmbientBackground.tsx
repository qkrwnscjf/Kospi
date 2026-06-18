import { motion } from 'framer-motion'

export function AmbientBackground() {
  return (
    <div className="fixed inset-0 -z-10 bg-background-base overflow-hidden">
      {/* Base Gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,#0a0a0f_0%,#050506_50%,#020203_100%)]" />
      
      {/* Animated Blobs */}
      <motion.div
        animate={{
          y: [-20, 20, -20],
          rotate: [0, 1, 0],
        }}
        transition={{
          duration: 10,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[900px] h-[1400px] bg-accent/20 blur-[150px] rounded-full"
      />
      
      <motion.div
        animate={{
          y: [20, -20, 20],
          rotate: [0, -1, 0],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="absolute top-[20%] -left-[10%] w-[600px] h-[800px] bg-purple-500/10 blur-[120px] rounded-full"
      />
      
      <motion.div
        animate={{
          y: [-30, 30, -30],
        }}
        transition={{
          duration: 12,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[700px] bg-indigo-500/10 blur-[100px] rounded-full"
      />

      {/* Grid Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
      
      {/* Noise Texture */}
      <div className="absolute inset-0 opacity-[0.015] pointer-events-none bg-noise" />
    </div>
  )
}
