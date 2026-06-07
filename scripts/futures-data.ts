/**
 * Chinese futures market data for import into Qdrant (RAG) and PostgreSQL (semantic store).
 * Data sources: CFFEX, SHFE, DCE, CZCE official contract specifications.
 */

export const futuresContracts = [
  // === CFFEX (China Financial Futures Exchange) ===
  {
    source: 'CFFEX_IF',
    exchange: 'CFFEX',
    product: 'IF',
    name: '沪深300股指期货',
    assetClass: 'equity_index',
    multiplier: 300,
    tickSize: 0.2,
    marginRate: '8%',
    tradingHours: '9:30-11:30, 13:00-15:00',
    contractMonths: '当月、下月及随后两个季月',
    lastTradingDay: '合约到期月份的第三个周五',
    settlement: '现金交割',
    content: `沪深300股指期货（IF）是中国金融期货交易所上市的旗舰品种，跟踪沪深300指数。
合约乘数为每点300元人民币，最小变动价位为0.2点（60元/手）。
最低交易保证金为合约价值的8%。
合约月份为当月、下月及随后两个季月。
交易时间为上午9:30-11:30，下午13:00-15:00。
最后交易日为合约到期月份的第三个周五。
采用现金交割方式，交割结算价为最后交易日沪深300指数最后2小时的算术平均价。
涨跌停板幅度为上一交易日结算价的±10%。`,
  },
  {
    source: 'CFFEX_IH',
    exchange: 'CFFEX',
    product: 'IH',
    name: '上证50股指期货',
    assetClass: 'equity_index',
    multiplier: 300,
    tickSize: 0.2,
    marginRate: '8%',
    tradingHours: '9:30-11:30, 13:00-15:00',
    contractMonths: '当月、下月及随后两个季月',
    lastTradingDay: '合约到期月份的第三个周五',
    settlement: '现金交割',
    content: `上证50股指期货（IH）是中国金融期货交易所上市的品种，跟踪上证50指数。
合约乘数为每点300元人民币，最小变动价位为0.2点（60元/手）。
最低交易保证金为合约价值的8%。
合约月份为当月、下月及随后两个季月。
交易时间为上午9:30-11:30，下午13:00-15:00。
最后交易日为合约到期月份的第三个周五。
采用现金交割方式。涨跌停板幅度为上一交易日结算价的±10%。`,
  },
  {
    source: 'CFFEX_IC',
    exchange: 'CFFEX',
    product: 'IC',
    name: '中证500股指期货',
    assetClass: 'equity_index',
    multiplier: 200,
    tickSize: 0.2,
    marginRate: '10%',
    tradingHours: '9:30-11:30, 13:00-15:00',
    contractMonths: '当月、下月及随后两个季月',
    lastTradingDay: '合约到期月份的第三个周五',
    settlement: '现金交割',
    content: `中证500股指期货（IC）是中国金融期货交易所上市的品种，跟踪中证500指数。
合约乘数为每点200元人民币，最小变动价位为0.2点（40元/手）。
最低交易保证金为合约价值的10%。
合约月份为当月、下月及随后两个季月。
交易时间为上午9:30-11:30，下午13:00-15:00。
最后交易日为合约到期月份的第三个周五。
采用现金交割方式。涨跌停板幅度为上一交易日结算价的±10%。`,
  },
  {
    source: 'CFFEX_IM',
    exchange: 'CFFEX',
    product: 'IM',
    name: '中证1000股指期货',
    assetClass: 'equity_index',
    multiplier: 200,
    tickSize: 0.2,
    marginRate: '10%',
    tradingHours: '9:30-11:30, 13:00-15:00',
    contractMonths: '当月、下月及随后两个季月',
    lastTradingDay: '合约到期月份的第三个周五',
    settlement: '现金交割',
    content: `中证1000股指期货（IM）是中国金融期货交易所上市的品种，跟踪中证1000指数。
合约乘数为每点200元人民币，最小变动价位为0.2点（40元/手）。
最低交易保证金为合约价值的10%。
合约月份为当月、下月及随后两个季月。
最后交易日为合约到期月份的第三个周五。采用现金交割。`,
  },
  {
    source: 'CFFEX_T',
    exchange: 'CFFEX',
    product: 'T',
    name: '10年期国债期货',
    assetClass: 'bond',
    multiplier: 10000,
    tickSize: 0.005,
    marginRate: '2%',
    tradingHours: '9:30-11:30, 13:00-15:15',
    contractMonths: '最近的三个季月',
    lastTradingDay: '合约到期月份的第二个周五',
    settlement: '实物交割',
    content: `10年期国债期货（T）是中国金融期货交易所上市的利率期货品种。
合约面值为100万元人民币，合约乘数为10000元/点。
最小变动价位为0.005元（50元/手）。
最低交易保证金为合约价值的2%。
合约月份为最近的三个季月（3月、6月、9月、12月循环）。
交易时间为上午9:30-11:30，下午13:00-15:15。
最后交易日为合约到期月份的第二个周五。
采用实物交割方式。涨跌停板幅度为上一交易日结算价的±2%。`,
  },
  {
    source: 'CFFEX_TF',
    exchange: 'CFFEX',
    product: 'TF',
    name: '5年期国债期货',
    assetClass: 'bond',
    multiplier: 10000,
    tickSize: 0.005,
    marginRate: '1.2%',
    tradingHours: '9:30-11:30, 13:00-15:15',
    contractMonths: '最近的三个季月',
    lastTradingDay: '合约到期月份的第二个周五',
    settlement: '实物交割',
    content: `5年期国债期货（TF）是中国金融期货交易所上市的利率期货品种。
合约面值为100万元人民币。最小变动价位为0.005元（50元/手）。
最低交易保证金为合约价值的1.2%。合约月份为最近的三个季月。
交易时间为上午9:30-11:30，下午13:00-15:15。
采用实物交割方式。涨跌停板幅度为±1.2%。`,
  },
  // === SHFE (Shanghai Futures Exchange) ===
  {
    source: 'SHFE_CU',
    exchange: 'SHFE',
    product: 'CU',
    name: '铜期货',
    assetClass: 'commodity_metal',
    multiplier: 5,
    tickSize: 10,
    marginRate: '9%',
    tradingHours: '9:00-10:15, 10:30-11:30, 13:30-15:00, 21:00-01:00',
    contractMonths: '1-12月',
    lastTradingDay: '交割月份的15日',
    settlement: '实物交割',
    content: `铜期货（CU）在上海期货交易所上市交易。
交易单位为5吨/手，最小变动价位为10元/吨（50元/手）。
最低交易保证金为合约价值的9%。
合约月份为1-12月。
交易时间：上午9:00-10:15, 10:30-11:30，下午13:30-15:00，夜盘21:00-01:00。
最后交易日为交割月份的15日（遇法定假日顺延）。
采用实物交割。交割品为标准阴极铜。涨跌停板幅度为±5%。`,
  },
  {
    source: 'SHFE_AU',
    exchange: 'SHFE',
    product: 'AU',
    name: '黄金期货',
    assetClass: 'commodity_precious',
    multiplier: 1000,
    tickSize: 0.02,
    marginRate: '8%',
    tradingHours: '9:00-10:15, 10:30-11:30, 13:30-15:00, 21:00-02:30',
    contractMonths: '最近三个连续月及随后双数月',
    lastTradingDay: '交割月份的15日',
    settlement: '实物交割',
    content: `黄金期货（AU）在上海期货交易所上市交易。
交易单位为1000克/手，最小变动价位为0.02元/克（20元/手）。
最低交易保证金为合约价值的8%。
合约月份为最近三个连续月及随后双数月。
交易时间：上午9:00-10:15, 10:30-11:30，下午13:30-15:00，夜盘21:00-02:30。
最后交易日为交割月份的15日。采用实物交割。
交割品为金含量不小于99.95%的国产金锭。涨跌停板±5%。`,
  },
  {
    source: 'SHFE_AG',
    exchange: 'SHFE',
    product: 'AG',
    name: '白银期货',
    assetClass: 'commodity_precious',
    multiplier: 15,
    tickSize: 1,
    marginRate: '7%',
    tradingHours: '9:00-10:15, 10:30-11:30, 13:30-15:00, 21:00-02:30',
    contractMonths: '1-12月',
    lastTradingDay: '交割月份的15日',
    settlement: '实物交割',
    content: `白银期货（AG）在上海期货交易所上市交易。
交易单位为15千克/手，最小变动价位为1元/千克（15元/手）。
最低交易保证金为合约价值的7%。
合约月份为1-12月。交易时间含夜盘21:00-02:30。
最后交易日为交割月份的15日。实物交割。涨跌停板±5%。`,
  },
  {
    source: 'SHFE_RB',
    exchange: 'SHFE',
    product: 'RB',
    name: '螺纹钢期货',
    assetClass: 'commodity_steel',
    multiplier: 10,
    tickSize: 1,
    marginRate: '8%',
    tradingHours: '9:00-10:15, 10:30-11:30, 13:30-15:00, 21:00-23:00',
    contractMonths: '1-12月',
    lastTradingDay: '交割月份的15日',
    settlement: '实物交割',
    content: `螺纹钢期货（RB）在上海期货交易所上市，是中国成交量最大的商品期货品种之一。
交易单位为10吨/手，最小变动价位为1元/吨（10元/手）。
最低交易保证金为合约价值的8%。
合约月份为1-12月。交易时间含夜盘21:00-23:00。
最后交易日为交割月份的15日。实物交割。
交割品为HRB400或HRB400E螺纹钢。涨跌停板±6%。`,
  },
  // === DCE (Dalian Commodity Exchange) ===
  {
    source: 'DCE_I',
    exchange: 'DCE',
    product: 'I',
    name: '铁矿石期货',
    assetClass: 'commodity_mineral',
    multiplier: 100,
    tickSize: 0.5,
    marginRate: '10%',
    tradingHours: '9:00-10:15, 10:30-11:30, 13:30-15:00, 21:00-23:00',
    contractMonths: '1-12月',
    lastTradingDay: '交割月份最后一个交易日',
    settlement: '实物交割',
    content: `铁矿石期货（I）在大连商品交易所上市，是中国钢铁产业链重要的定价参考。
交易单位为100吨/手，最小变动价位为0.5元/吨（50元/手）。
最低交易保证金为合约价值的10%。
合约月份为1-12月。交易时间含夜盘21:00-23:00。
最后交易日为交割月份最后一个交易日。实物交割。
交割品为铁品位62%的粉矿。涨跌停板±7%。`,
  },
  {
    source: 'DCE_M',
    exchange: 'DCE',
    product: 'M',
    name: '豆粕期货',
    assetClass: 'commodity_agri',
    multiplier: 10,
    tickSize: 1,
    marginRate: '6%',
    tradingHours: '9:00-10:15, 10:30-11:30, 13:30-15:00, 21:00-23:00',
    contractMonths: '1,3,5,7,8,9,11,12月',
    lastTradingDay: '交割月份第10个交易日',
    settlement: '实物交割',
    content: `豆粕期货（M）在大连商品交易所上市，是饲料行业重要的风险管理工具。
交易单位为10吨/手，最小变动价位为1元/吨（10元/手）。
最低交易保证金为合约价值的6%。
合约月份为1,3,5,7,8,9,11,12月。
交易时间含夜盘21:00-23:00。
最后交易日为交割月份第10个交易日。实物交割。涨跌停板±5%。`,
  },
  {
    source: 'DCE_JD',
    exchange: 'DCE',
    product: 'JD',
    name: '鸡蛋期货',
    assetClass: 'commodity_agri',
    multiplier: 10,
    tickSize: 1,
    marginRate: '7%',
    tradingHours: '9:00-10:15, 10:30-11:30, 13:30-15:00',
    contractMonths: '1-12月',
    lastTradingDay: '交割月份第10个交易日',
    settlement: '实物交割',
    content: `鸡蛋期货（JD）在大连商品交易所上市，是中国首个鲜活农产品期货。
交易单位为10吨/手（约500箱），最小变动价位为1元/500千克。
最低交易保证金为合约价值的7%。
合约月份为1-12月。无夜盘交易。
最后交易日为交割月份第10个交易日。实物交割。涨跌停板±5%。`,
  },
  // === CZCE (Zhengzhou Commodity Exchange) ===
  {
    source: 'CZCE_CF',
    exchange: 'CZCE',
    product: 'CF',
    name: '棉花期货',
    assetClass: 'commodity_agri',
    multiplier: 5,
    tickSize: 5,
    marginRate: '7%',
    tradingHours: '9:00-10:15, 10:30-11:30, 13:30-15:00, 21:00-23:00',
    contractMonths: '1,3,5,7,9,11月',
    lastTradingDay: '交割月份第10个交易日',
    settlement: '实物交割',
    content: `棉花期货（CF）在郑州商品交易所上市，是纺织行业重要的价格发现工具。
交易单位为5吨/手，最小变动价位为5元/吨（25元/手）。
最低交易保证金为合约价值的7%。
合约月份为1,3,5,7,9,11月。交易时间含夜盘21:00-23:00。
最后交易日为交割月份第10个交易日。实物交割。
交割品为锯齿细绒白棉。涨跌停板±5%。`,
  },
  {
    source: 'CZCE_AP',
    exchange: 'CZCE',
    product: 'AP',
    name: '苹果期货',
    assetClass: 'commodity_agri',
    multiplier: 10,
    tickSize: 1,
    marginRate: '8%',
    tradingHours: '9:00-10:15, 10:30-11:30, 13:30-15:00',
    contractMonths: '1,3,5,7,10,11,12月',
    lastTradingDay: '交割月份第10个交易日',
    settlement: '实物交割',
    content: `苹果期货（AP）在郑州商品交易所上市，是全球首个鲜果类期货品种。
交易单位为10吨/手，最小变动价位为1元/吨（10元/手）。
最低交易保证金为合约价值的8%。
合约月份为1,3,5,7,10,11,12月。无夜盘交易。
最后交易日为交割月份第10个交易日。实物交割。涨跌停板±6%。`,
  },
  {
    source: 'CZCE_TA',
    exchange: 'CZCE',
    product: 'TA',
    name: 'PTA期货',
    assetClass: 'commodity_chemical',
    multiplier: 5,
    tickSize: 2,
    marginRate: '6%',
    tradingHours: '9:00-10:15, 10:30-11:30, 13:30-15:00, 21:00-23:00',
    contractMonths: '1-12月',
    lastTradingDay: '交割月份第10个交易日',
    settlement: '实物交割',
    content: `PTA期货（TA）在郑州商品交易所上市，是化纤产业链核心品种。
交易单位为5吨/手，最小变动价位为2元/吨（10元/手）。
最低交易保证金为合约价值的6%。合约月份为1-12月。
交易时间含夜盘21:00-23:00。
最后交易日为交割月份第10个交易日。实物交割。涨跌停板±5%。`,
  },
  {
    source: 'CZCE_MA',
    exchange: 'CZCE',
    product: 'MA',
    name: '甲醇期货',
    assetClass: 'commodity_chemical',
    multiplier: 10,
    tickSize: 1,
    marginRate: '7%',
    tradingHours: '9:00-10:15, 10:30-11:30, 13:30-15:00, 21:00-23:00',
    contractMonths: '1-12月',
    lastTradingDay: '交割月份第10个交易日',
    settlement: '实物交割',
    content: `甲醇期货（MA）在郑州商品交易所上市，是煤化工产业链重要品种。
交易单位为10吨/手，最小变动价位为1元/吨（10元/手）。
最低交易保证金为合约价值的7%。合约月份为1-12月。
交易时间含夜盘21:00-23:00。
最后交易日为交割月份第10个交易日。实物交割。涨跌停板±5%。`,
  },
];
