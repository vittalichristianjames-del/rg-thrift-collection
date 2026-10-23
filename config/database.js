const { Sequelize } = require('sequelize');

let sequelize;

if (process.env.DATABASE_URL) {
  // Production (PostgreSQL)
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  });
} else {
  // Development (SQLite)
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './data/rg-thrift.sqlite',
    logging: false
  });
}

module.exports = { sequelize };