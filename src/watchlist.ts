export interface Stock {
  symbol: string;
  name: string;
}

export const watchlist: Stock[] = [
  { symbol: 'NVDA', name: 'NVIDIA' },
  { symbol: 'SNDK', name: 'SanDisk' },
  { symbol: 'AXTI', name: 'AXT Inc' },
  { symbol: 'CVX', name: 'Chevron' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'NFLX', name: 'Netflix' },
  { symbol: 'LMT', name: 'Lockheed Martin' },
  { symbol: 'AEM', name: 'Agnico Eagle Mines' },
  { symbol: 'CCJ', name: 'Cameco Corp' },
];
