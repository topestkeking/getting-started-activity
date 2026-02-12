export const PIECES = {
  EMPTY: 0,
  RED: 1,
  BLACK: 2,
  RED_KING: 3,
  BLACK_KING: 4,
};

export class CheckersGame {
  constructor() {
    this.board = this.createBoard();
    this.turn = PIECES.RED; // Red starts
    this.winner = null;
    this.mandatoryJumpMoves = []; // Stores possible jump moves for current turn
    this.history = [];
    this.updateMandatoryJumps();
  }

  createBoard() {
    const board = Array(8).fill(null).map(() => Array(8).fill(PIECES.EMPTY));
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 1) {
          if (r < 3) board[r][c] = PIECES.BLACK;
          else if (r > 4) board[r][c] = PIECES.RED;
        }
      }
    }
    return board;
  }

  getPiece(r, c) {
    if (r < 0 || r >= 8 || c < 0 || c >= 8) return null;
    return this.board[r][c];
  }

  isKing(piece) {
    return piece === PIECES.RED_KING || piece === PIECES.BLACK_KING;
  }

  getOwner(piece) {
    if (piece === PIECES.RED || piece === PIECES.RED_KING) return PIECES.RED;
    if (piece === PIECES.BLACK || piece === PIECES.BLACK_KING) return PIECES.BLACK;
    return null;
  }

  updateMandatoryJumps() {
    this.mandatoryJumpMoves = this.getAllJumps(this.turn);
  }

  getAllJumps(player) {
    const jumps = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = this.board[r][c];
        if (this.getOwner(piece) === player) {
          const pieceJumps = this.getPieceJumps(r, c);
          jumps.push(...pieceJumps);
        }
      }
    }
    return jumps;
  }

  getPieceJumps(r, c) {
    const piece = this.board[r][c];
    const owner = this.getOwner(piece);
    const isKing = this.isKing(piece);
    const jumps = [];

    const directions = [];
    if (owner === PIECES.RED || isKing) {
      directions.push([-1, -1], [-1, 1]);
    }
    if (owner === PIECES.BLACK || isKing) {
      directions.push([1, -1], [1, 1]);
    }

    for (const [dr, dc] of directions) {
      const midR = r + dr;
      const midC = c + dc;
      const endR = r + 2 * dr;
      const endC = c + 2 * dc;

      if (this.isValidCoord(endR, endC)) {
        const midPiece = this.getPiece(midR, midC);
        const endPiece = this.getPiece(endR, endC);
        if (midPiece !== PIECES.EMPTY && this.getOwner(midPiece) !== owner && endPiece === PIECES.EMPTY) {
          jumps.push({ from: { r, c }, to: { r: endR, c: endC }, captured: { r: midR, c: midC } });
        }
      }
    }
    return jumps;
  }

  isValidCoord(r, c) {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
  }

  getValidMoves(r, c) {
    const piece = this.getPiece(r, c);
    const owner = this.getOwner(piece);
    if (owner !== this.turn) return [];

    // If there are mandatory jumps, only those are valid
    if (this.mandatoryJumpMoves.length > 0) {
      return this.mandatoryJumpMoves.filter(m => m.from.r === r && m.from.c === c);
    }

    // Otherwise, normal moves
    const isKing = this.isKing(piece);
    const moves = [];
    const directions = [];
    if (owner === PIECES.RED || isKing) {
      directions.push([-1, -1], [-1, 1]);
    }
    if (owner === PIECES.BLACK || isKing) {
      directions.push([1, -1], [1, 1]);
    }

    for (const [dr, dc] of directions) {
      const nr = r + dr;
      const nc = c + dc;
      if (this.isValidCoord(nr, nc) && this.getPiece(nr, nc) === PIECES.EMPTY) {
        moves.push({ from: { r, c }, to: { r: nr, c: nc } });
      }
    }
    return moves;
  }

  applyMove(from, to) {
    const validMoves = this.getValidMoves(from.r, from.c);
    const move = validMoves.find(m => m.to.r === to.r && m.to.c === to.c);

    if (!move) return false;

    let piece = this.board[from.r][from.c];
    const pieceName = this.getPieceName(piece);

    // Perform move
    this.board[to.r][to.c] = piece;
    this.board[from.r][from.c] = PIECES.EMPTY;

    let captured = false;
    if (move.captured) {
      this.board[move.captured.r][move.captured.c] = PIECES.EMPTY;
      captured = true;
    }

    // Promotion
    let promoted = false;
    if (piece === PIECES.RED && to.r === 0) {
      this.board[to.r][to.c] = PIECES.RED_KING;
      piece = PIECES.RED_KING;
      promoted = true;
    } else if (piece === PIECES.BLACK && to.r === 7) {
      this.board[to.r][to.c] = PIECES.BLACK_KING;
      piece = PIECES.BLACK_KING;
      promoted = true;
    }

    this.history.push({
      player: this.turn,
      from,
      to,
      piece: pieceName,
      captured: captured ? move.captured : null,
      promoted
    });

    if (captured && !promoted) {
      const furtherJumps = this.getPieceJumps(to.r, to.c);
      if (furtherJumps.length > 0) {
        this.mandatoryJumpMoves = furtherJumps;
        return true; // Still same player's turn
      }
    }

    this.turn = this.turn === PIECES.RED ? PIECES.BLACK : PIECES.RED;
    this.updateMandatoryJumps();
    this.checkWinner();
    return true;
  }

  getPieceName(piece) {
    if (piece === PIECES.RED) return "Red Pawn";
    if (piece === PIECES.RED_KING) return "Red King";
    if (piece === PIECES.BLACK) return "Black Pawn";
    if (piece === PIECES.BLACK_KING) return "Black King";
    return "Empty";
  }

  skipTurn() {
    this.history.push({
      player: this.turn,
      action: "timeout"
    });
    this.turn = this.turn === PIECES.RED ? PIECES.BLACK : PIECES.RED;
    this.updateMandatoryJumps();
    this.checkWinner();
  }

  checkWinner() {
    const hasMoves = this.hasAnyLegalMoves(this.turn);
    if (!hasMoves) {
      this.winner = this.turn === PIECES.RED ? PIECES.BLACK : PIECES.RED;
    }
  }

  hasAnyLegalMoves(player) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (this.getOwner(this.board[r][c]) === player) {
          if (this.getValidMoves(r, c).length > 0) return true;
        }
      }
    }
    return false;
  }

  getState() {
    return {
      board: this.board,
      turn: this.turn,
      winner: this.winner,
      mandatoryJumpMoves: this.mandatoryJumpMoves,
      history: this.history.slice(-10) // Only send last 10 for performance
    };
  }
}
