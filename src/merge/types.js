// @ts-check
/** @typedef {{x: number, y: number}} Point */
/** @typedef {{name: string, image: string, size: number, weight: number, score: number}} ItemConfig */
/**
 * All lengths are in world units, never CSS pixels. `size` is the longest
 * side of the nontransparent image bounds, preserving its aspect ratio.
 * @typedef {Object} Skin
 * @property {number} version
 * @property {string} name
 * @property {{width:number, height:number, dangerY:number, spawnY:number, wallThickness:number}} world
 * @property {{n:number, m:number, dropCooldown:number, mergeCooldown:number, overflowGrace:number, overflowMaxSpeed:number, newbornGrace:number, maxBodies:number, keyboardStep:number, avoidRepeat:boolean, repeatRetries:number}} rules
 * @property {{enabled:boolean,rangeMultiplier:number,rangePadding:number,speed:number,upwardBias:number,massExponent:number,minMassScale:number,maxMassScale:number,spin:number,strainKick:number,victorySeconds:number}} mergeBurst
 * @property {ItemConfig[]} items
 * @property {{background:string, surface:string, ink:string, accent:string, danger:string}} theme
 * @property {{unitsPerWorldUnit:number, fixedHz:number, maxSubSteps:number, maxFrameDelta:number, gravity:number, restitution:number, friction:number, frictionStatic:number, airDrag:number, density:number, slop:number, positionIterations:number, velocityIterations:number, sleepFrames:number, maxSpeed:number,bounceThreshold:number}} physics
 * @property {{enabled:boolean, maxStrain:number, stiffness:number, damping:number, impactGain:number, minImpactSpeed:number, impactCooldown:number, restCompression:number, settleEpsilon:number, scaleEpsilon:number,restResponse:number,restDeadband:number}} jelly
 * @property {{resolution:number, alphaThreshold:number, simplifyTolerance:number, maxParts:number}} collision
 * @property {{maxDpr:number, guideDash:number, lineWidth:number, particleCount:number, particleLifetime:number, particleSpeed:number, particleMinLifetimeRatio:number, particleMinSpeedRatio:number, particleOpacityMin:number, particleOpacityMax:number, particleGravity:number, maxParticles:number}} rendering
 */
/** @typedef {{image:HTMLCanvasElement, polygons:Point[][], width:number, height:number, center:Point, source:string, particleColors:string[]}} Sprite */
/** @typedef {{x:number,y:number,vx:number,vy:number,age:number,life:number,color:string,opacity:number}} Particle */
/** @typedef {{body:import('./matter-types.js').Body, level:number, born:number, overflow:number, strain:number, strainVelocity:number, restStrain:number, contactStrain:number, contactCount:number, lastImpact:number, appliedStrain:number}} Piece */
/** @typedef {{type:'drop'|'merge'|'bounce'|'win'|'lose'|'reset', x:number, y:number, level:number, strength:number}} GameEvent */
export {};
