const genesisState = {
  balances: {
    shredz7: 9900000,
    ausbitbank: 100000,
    "state-tester": 1000000,
    ra: 10000000
  },
  dex: {

  }
};

const genesisBlock = 28934806;

module.exports = {
  state: genesisState,
  block: genesisBlock
}
