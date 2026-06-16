package com.marketdata.config;

import com.marketdata.service.BinanceService;
import com.marketdata.service.DataSource;
import com.marketdata.service.OkxService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

/**
 * Selects the active data source based on configuration.
 * Defaults to OKX; can be switched to Binance via market.data.source property.
 * This mirrors the DATA_SOURCE env variable behavior from the original Node.js backend.
 */
@Configuration
public class DataSourceConfig {

    private static final Logger log = LoggerFactory.getLogger(DataSourceConfig.class);

    @Bean
    @Primary
    public DataSource activeDataSource(
            @Value("${market.data.source:okx}") String source,
            OkxService okxService,
            BinanceService binanceService) {

        DataSource selected;
        if ("binance".equalsIgnoreCase(source)) {
            selected = binanceService;
        } else {
            selected = okxService;
        }

        log.info("[DataSource] Selected: {}", selected.getName());
        return selected;
    }
}
