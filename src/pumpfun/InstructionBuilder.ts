import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  PUMP_FUN_PROGRAM_ID,
  PUMP_FUN_FEE_RECIPIENT,
  PUMP_FUN_EVENT_AUTHORITY,
  PUMP_FUN_GLOBAL_STATE,
  BUY_DISCRIMINATOR,
  SELL_DISCRIMINATOR,
} from '../constants';
import { getBondingCurvePda } from './AccountDecoder';

/**
 * Encode a u64 value as an 8-byte little-endian Buffer.
 */
function encodeU64LE(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

/**
 * Build the 12-account list for pump.fun buy/sell instructions.
 */
function buildPumpFunAccounts(
  mint: PublicKey,
  bondingCurvePda: PublicKey,
  associatedBondingCurve: PublicKey,
  userAta: PublicKey,
  user: PublicKey
) {
  return [
    { pubkey: PUMP_FUN_GLOBAL_STATE, isSigner: false, isWritable: false },
    { pubkey: PUMP_FUN_FEE_RECIPIENT, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: bondingCurvePda, isSigner: false, isWritable: true },
    { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
    { pubkey: userAta, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: PUMP_FUN_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PUMP_FUN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
}

export interface BuildBuyInstructionParams {
  mint: PublicKey;
  buyer: PublicKey;
  tokenAmount: bigint;     // tokens to buy (base units, 6 decimals)
  maxSolCost: bigint;      // max SOL to spend in lamports (includes slippage)
}

/**
 * Build a pump.fun buy instruction.
 *
 * Instruction data layout (24 bytes):
 *   [0..8]   BUY_DISCRIMINATOR
 *   [8..16]  tokenAmount as u64 LE
 *   [16..24] maxSolCost  as u64 LE
 */
export function buildBuyInstruction(params: BuildBuyInstructionParams): TransactionInstruction {
  const { mint, buyer, tokenAmount, maxSolCost } = params;

  const bondingCurvePda = getBondingCurvePda(mint);
  const associatedBondingCurve = getAssociatedTokenAddressSync(
    mint,
    bondingCurvePda,
    true // allowOwnerOffCurve — required since bondingCurve is a PDA
  );
  const userAta = getAssociatedTokenAddressSync(mint, buyer);

  const data = Buffer.concat([
    BUY_DISCRIMINATOR,
    encodeU64LE(tokenAmount),
    encodeU64LE(maxSolCost),
  ]);

  const keys = buildPumpFunAccounts(
    mint,
    bondingCurvePda,
    associatedBondingCurve,
    userAta,
    buyer
  );

  return new TransactionInstruction({
    programId: PUMP_FUN_PROGRAM_ID,
    keys,
    data,
  });
}

export interface BuildSellInstructionParams {
  mint: PublicKey;
  seller: PublicKey;
  tokenAmount: bigint;    // tokens to sell (base units, 6 decimals)
  minSolOutput: bigint;   // minimum SOL to receive in lamports (includes slippage)
}

/**
 * Build a pump.fun sell instruction.
 *
 * Instruction data layout (24 bytes):
 *   [0..8]   SELL_DISCRIMINATOR
 *   [8..16]  tokenAmount as u64 LE
 *   [16..24] minSolOutput as u64 LE
 */
export function buildSellInstruction(params: BuildSellInstructionParams): TransactionInstruction {
  const { mint, seller, tokenAmount, minSolOutput } = params;

  const bondingCurvePda = getBondingCurvePda(mint);
  const associatedBondingCurve = getAssociatedTokenAddressSync(
    mint,
    bondingCurvePda,
    true
  );
  const userAta = getAssociatedTokenAddressSync(mint, seller);

  const data = Buffer.concat([
    SELL_DISCRIMINATOR,
    encodeU64LE(tokenAmount),
    encodeU64LE(minSolOutput),
  ]);

  const keys = buildPumpFunAccounts(
    mint,
    bondingCurvePda,
    associatedBondingCurve,
    userAta,
    seller
  );

  return new TransactionInstruction({
    programId: PUMP_FUN_PROGRAM_ID,
    keys,
    data,
  });
}
