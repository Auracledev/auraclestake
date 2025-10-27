export async function checkTransactionDuplicate(
  supabaseClient: any,
  txSignature: string
): Promise<{ isDuplicate: boolean; existingTx?: any }> {
  const { data: existingTx, error } = await supabaseClient
    .from('transactions')
    .select('*')
    .eq('tx_signature', txSignature)
    .maybeSingle();

  if (error) {
    console.error('Transaction duplicate check error:', error);
    // Fail open - allow if we can't check
    return { isDuplicate: false };
  }

  if (existingTx) {
    return { isDuplicate: true, existingTx };
  }

  return { isDuplicate: false };
}
