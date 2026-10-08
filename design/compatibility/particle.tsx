import { Particle, ParticleContainer, Texture } from 'pixi.js';
const container = new ParticleContainer();
container.addParticle(new Particle(Texture.EMPTY));
container.removeParticles();
