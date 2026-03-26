import './styles.css';
import { Game } from './game/Game';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root element');

const game = new Game(root);
game.start();

