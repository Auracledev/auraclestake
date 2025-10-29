UPDATE stakers 
SET staked_amount = 0, 
    last_updated = NOW()
WHERE wallet_address = '5Yxovq832tezBgHRCMrwwAganP6Yg7TNk1npMQX5NfoD';
