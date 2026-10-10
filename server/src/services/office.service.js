const Office = require('../models/Office');

async function getOffice(officeId) {
  let office = await Office.findOne({ officeId });
  if (!office) {
    office = new Office({
      officeId,
      name: `Office ${officeId}`
    });
    await office.save();
  }
  return office;
}

module.exports = { getOffice };

