// Minimal dayjs shim for sandbox testing
module.exports = (d) => {
  const date = d ? new Date(d) : new Date();
  return {
    add: (n, unit) => {
      const r = new Date(date);
      if (unit === 'day') r.setDate(r.getDate() + n);
      return module.exports(r);
    },
    diff: (other, unit) => {
      const ms = date - (other._date || new Date());
      if (unit === 'day') return Math.ceil(ms / 86400000);
      return ms;
    },
    format: (fmt) => date.toLocaleDateString('en-IN'),
    _date: date,
  };
};
